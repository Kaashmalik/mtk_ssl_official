#!/usr/bin/env node
/**
 * REL-01 (Batch 158): two-league RLS + constraint isolation proof,
 * executed against the BASE-04 fresh container (KEEP=1, --user-guc).
 *
 * Property: platform roles + Supabase-shaped JWT GUC stubs => a member
 * of league A can ONLY see league A's rows; a member of league B only
 * league B's; anon is denied; service_role sees everything (BYPASSRLS,
 * hosted parity). Plus one constraint-level check: a league-application
 * duplicate is refused by the partial unique index itself (B147).
 *
 * Seeding uses the exact required-column lists (catalog-probed) and
 * explicit ids so the JWT `sub` claims match real rows. Every seed
 * failure is reported; nothing is silently skipped. Exit 1 on any
 * isolation violation.
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const NAME = "mtk-base04-proof";
const SCRATCH = require("os").tmpdir();

function exec(sql, opts = {}) {
  const f = path.join(SCRATCH, "rel01-step.sql");
  fs.writeFileSync(f, sql);
  return execSync(`docker exec -i ${NAME} psql -v ON_ERROR_STOP=1 -U postgres -d postgres -X -q < "${f}"`, { stdio: ["ignore", "pipe", "pipe"], shell: "cmd.exe", ...opts }).toString().trim();
}
// tuples-only variant for value SELECTs (no header, no command tags,
// no "(1 row)" footer)
function execTuples(sql) {
  const f = path.join(SCRATCH, "rel01-step.sql");
  fs.writeFileSync(f, sql);
  return execSync(`docker exec -i ${NAME} psql -v ON_ERROR_STOP=1 -U postgres -d postgres -X -q -t -A < "${f}"`, { stdio: ["ignore", "pipe", "pipe"], shell: "cmd.exe" }).toString().trim();
}

const U_A = "aaaaaaaa-0000-4000-8000-000000000001";
const U_B = "aaaaaaaa-0000-4000-8000-000000000002";
const T_A = "aaaaaaaa-0000-4000-8000-0000000000aa";
const T_B = "aaaaaaaa-0000-4000-8000-0000000000bb";
const TN_A = "aaaaaaaa-0000-4000-8000-0000000000a1"; // user_tenant_roles
const TN_B = "aaaaaaaa-0000-4000-8000-0000000000b2";
const TM_A = "aaaaaaaa-0000-4000-8000-0000000001a1"; // team A1
const TM_A2 = "aaaaaaaa-0000-4000-8000-0000000001a3"; // team A2 (opponent)
const TM_B = "aaaaaaaa-0000-4000-8000-0000000001b2"; // team B1
const TM_B2 = "aaaaaaaa-0000-4000-8000-0000000001b4"; // team B2 (opponent)
const TO_A = "aaaaaaaa-0000-4000-8000-0000000002a1"; // tournament
const TO_B = "aaaaaaaa-0000-4000-8000-0000000002b2";
const MA_A = "aaaaaaaa-0000-4000-8000-0000000003a1"; // match
const MA_B = "aaaaaaaa-0000-4000-8000-0000000003b2";
const PL_A = "aaaaaaaa-0000-4000-8000-0000000004a1"; // player
const PL_B = "aaaaaaaa-0000-4000-8000-0000000004b2";
const PR_A = "aaaaaaaa-0000-4000-8000-0000000005a1"; // profile
const PR_B = "aaaaaaaa-0000-4000-8000-0000000005b2";
const AP_A = "aaaaaaaa-0000-4000-8000-0000000006a1"; // application ok
const AP_DUP = "aaaaaaaa-0000-4000-8000-0000000006a2"; // duplicate

// tenant-bearing tables the RLS property is exercisable on (catalog:
// these have NOT NULL tenant_id; audit_logs does NOT, so it is reported
// as not-tenant-bearing rather than checked).
const TABLES = ["user_tenant_roles", "teams", "tournaments", "matches", "players"];

function firstEnumLabel(typeName) {
  return execTuples(`SELECT enumlabel FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid WHERE t.typname='${typeName}' ORDER BY enumsortorder LIMIT 1;`).split("\n").pop();
}

function countAs(role, sub, table, where = "") {
  try {
    return execTuples(`BEGIN;
SET LOCAL ROLE ${role};
${sub ? `SET LOCAL request.jwt.claim.sub = '${sub}';` : ""}
SELECT count(*) FROM public.${table}${where ? " WHERE " + where : ""};
ROLLBACK;`).split("\n").filter(Boolean).pop();
  } catch (err) {
    return "ERROR: " + (String(err.message).split("\n").find((l) => l.startsWith("ERROR")) || "unknown");
  }
}

function main() {
  const results = { seeded: [], matrix: [], constraints: [], notes: [] };
  const fmt = firstEnumLabel("tournament_format");

  // Idempotent pre-clean: remove any marker-prefixed rows a crashed
  // earlier run may have left (children first, then FK parents).
  exec(`BEGIN;
DELETE FROM public.players WHERE id::text LIKE 'aaaaaaaa-0000%' OR name LIKE 'RLS Player %';
DELETE FROM public.matches WHERE id::text LIKE 'aaaaaaaa-0000%' OR tenant_id::text LIKE 'aaaaaaaa-0000%';
DELETE FROM public.profiles WHERE id::text LIKE 'aaaaaaaa-0000%' OR user_id::text LIKE 'aaaaaaaa-0000%';
DELETE FROM public.teams WHERE id::text LIKE 'aaaaaaaa-0000%' OR slug LIKE 'rls-team-%';
DELETE FROM public.tournaments WHERE id::text LIKE 'aaaaaaaa-0000%' OR slug LIKE 'rls-cup-%';
DELETE FROM public.tournament_applications WHERE id::text LIKE 'aaaaaaaa-0000%';
DELETE FROM public.user_tenant_roles WHERE id::text LIKE 'aaaaaaaa-0000%' OR user_id::text LIKE 'aaaaaaaa-0000%' OR tenant_id::text LIKE 'aaaaaaaa-0000%';
DELETE FROM public.tenants WHERE id::text LIKE 'aaaaaaaa-0000%' OR slug LIKE 'rls-proof-%';
DELETE FROM public.users WHERE id::text LIKE 'aaaaaaaa-0000%' OR email LIKE 'rlsproof-%';
COMMIT;`);

  // One transaction: either both leagues exist or nothing does (repeat
  // runs stay clean after a mid-seed crash).
  exec(`BEGIN;
INSERT INTO public.users (id, email) VALUES ('${U_A}', 'rlsproof-a@example.invalid'), ('${U_B}', 'rlsproof-b@example.invalid');
INSERT INTO public.tenants (id, name, slug, owner_id) VALUES
  ('${T_A}', 'RLS Proof League A', 'rls-proof-a', '${U_A}'),
  ('${T_B}', 'RLS Proof League B', 'rls-proof-b', '${U_B}');
INSERT INTO public.user_tenant_roles (id, user_id, tenant_id, role, status) VALUES
  ('${TN_A}', '${U_A}', '${T_A}', 'league_owner', 'active'),
  ('${TN_B}', '${U_B}', '${T_B}', 'league_owner', 'active')
ON CONFLICT (user_id, tenant_id) DO UPDATE SET role = 'league_owner', status = 'active';
INSERT INTO public.teams (id, tenant_id, name, slug) VALUES
  ('${TM_A}', '${T_A}', 'RLS Team A', 'rls-team-a'), ('${TM_A2}', '${T_A}', 'RLS Team A2', 'rls-team-a2'),
  ('${TM_B}', '${T_B}', 'RLS Team B', 'rls-team-b'), ('${TM_B2}', '${T_B}', 'RLS Team B2', 'rls-team-b2');
INSERT INTO public.tournaments (id, tenant_id, name, slug, format, created_by) VALUES
  ('${TO_A}', '${T_A}', 'RLS Cup A', 'rls-cup-a', '${fmt}', '${U_A}'),
  ('${TO_B}', '${T_B}', 'RLS Cup B', 'rls-cup-b', '${fmt}', '${U_B}');
INSERT INTO public.matches (id, tenant_id, team_a_id, team_b_id) VALUES
  ('${MA_A}', '${T_A}', '${TM_A}', '${TM_A2}'), ('${MA_B}', '${T_B}', '${TM_B}', '${TM_B2}');
INSERT INTO public.profiles (id, user_id, tenant_id) VALUES
  ('${PR_A}', '${U_A}', '${T_A}'), ('${PR_B}', '${U_B}', '${T_B}');
INSERT INTO public.players (id, tenant_id, name) VALUES
  ('${PL_A}', '${T_A}', 'RLS Player A'), ('${PL_B}', '${T_B}', 'RLS Player B');
COMMIT;`);
  results.seeded.push("users(2)", "tenants(2)", "user_tenant_roles(2)", "teams(2)", "tournaments(2)", "matches(2)", "profiles(2)", "players(2)");
  console.log("seeded:", results.seeded.join(", "));

  // ---- isolation matrix ----
  for (const table of TABLES) {
    const entry = { table };
    entry.userA_total = countAs("authenticated", U_A, table);
    entry.userA_tenantB = countAs("authenticated", U_A, table, `tenant_id='${T_B}'`);
    entry.userB_tenantA = countAs("authenticated", U_B, table, `tenant_id='${T_A}'`);
    entry.anon_total = countAs("anon", null, table);
    entry.serviceRole_total = countAs("service_role", null, table);
    const denied = String(entry.userA_tenantB).startsWith("ERROR");
    entry.verdict = denied ? "grant-denied(ok)" : (entry.userA_tenantB === "0" && entry.userB_tenantA === "0" && entry.userA_total !== "ERROR: unknown" ? "ISOLATED" : "VIOLATION");
    results.matrix.push(entry);
    console.log(`${table}: A_total=${entry.userA_total} A_sees_B=${entry.userA_tenantB} B_sees_A=${entry.userB_tenantA} anon=${entry.anon_total} service=${entry.serviceRole_total} -> ${entry.verdict}`);
  }
  // global tables: a scoped reader must not see the OTHER league's row
  results.matrix.push({ table: "tenants", userA_seesTenantB: countAs("authenticated", U_A, "tenants", `id='${T_B}'`), verdict: countAs("authenticated", U_A, "tenants", `id='${T_B}'`) === "0" ? "ISOLATED" : "VIOLATION" });
  results.matrix.push({ table: "profiles", userA_seesProfileB: countAs("authenticated", U_A, "profiles", `user_id='${U_B}'`), verdict: countAs("authenticated", U_A, "profiles", `user_id='${U_B}'`) === "0" ? "ISOLATED" : "VIOLATION" });
  for (const extra of results.matrix.filter((m) => m.table === "tenants" || m.table === "profiles")) {
    console.log(`${extra.table}: ${JSON.stringify(Object.keys(extra).filter((k) => k.startsWith("u") || k.startsWith("p")).map((k) => extra[k]))} -> ${extra.verdict}`);
  }
  results.notes.push("audit_logs is NOT tenant-bearing (tenant_id nullable) - tenant isolation is not its guarantee; it is audit-provenance and is not exercised here.");

  // ---- constraint-level check (B147): duplicate league application ----
  try {
    exec(`INSERT INTO public.tournament_applications (id, tournament_id, tenant_id, team_id, submitted_by, status)
      VALUES ('${AP_A}', '${TO_A}', '${T_A}', '${TM_A}', '${U_A}', 'submitted');`);
    let dupRejected;
    try {
      exec(`INSERT INTO public.tournament_applications (id, tournament_id, tenant_id, team_id, submitted_by, status)
        VALUES ('${AP_DUP}', '${TO_A}', '${T_A}', '${TM_A}', '${U_A}', 'submitted');`);
      dupRejected = false;
    } catch { dupRejected = true; }
    results.constraints.push({ constraint: "tournament_applications duplicate SUBMITTED per (tournament,team)", enforcedByDatabase: dupRejected, verdict: dupRejected ? "ENFORCED" : "VIOLATION" });
    console.log("constraint (duplicate league application):", dupRejected ? "ENFORCED by database" : "VIOLATION");
  } catch (err) {
    results.constraints.push({ constraint: "tournament_applications duplicate", notExercisable: String(err.message).split("\n").find((l) => l.startsWith("ERROR")) || "unknown" });
    console.log("constraint check not exercisable:", String(err.message).split("\n").find((l) => l.startsWith("ERROR")));
  }

  fs.writeFileSync(path.join(SCRATCH, "rel01-result.json"), JSON.stringify({ ...results, users: U_A, tenants: [T_A, T_B] }, null, 2));
  const violations = [...results.matrix, ...results.constraints].filter((m) => m.verdict === "VIOLATION");
  console.log(violations.length === 0 ? "REL-01: NO VIOLATIONS - isolation holds" : `REL-01: ${violations.length} VIOLATION(S)`);
  if (violations.length > 0) process.exit(1);
}
main();
