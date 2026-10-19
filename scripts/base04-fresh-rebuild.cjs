#!/usr/bin/env node
/**
 * BASE-04 (Batch 158): fresh-rebuild drill, committed and repeatable.
 * Builds the complete schema from supabase/migrations alone inside a
 * throwaway Postgres container, under a minimal documented Supabase-
 * compatible prelude.
 *
 * --user-guc   auth.uid()/auth.role()/auth.jwt() read Supabase's JWT
 *              GUCs (request.jwt.claim.sub / .role / .claims) so RLS
 *              policies can be EXERCISED by setting those (REL-01),
 *              not just parsed. Without it the stubs return NULL =>
 *              policies parse and deny by default.
 * KEEP=1       keep the container after the run (for follow-on drills).
 * Env: BASE04_PG_IMAGE (default postgres:15-alpine), BASE04_PORT (55432).
 * Returns exit 1 if any migration fails.
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const os = require("os");

const ROOT = path.join(__dirname, "..");
const MIGRATIONS = path.join(ROOT, "supabase", "migrations");
const IMAGE = process.env.BASE04_PG_IMAGE || "postgres:15-alpine";
const NAME = "mtk-base04-proof";
const SCRATCH = os.tmpdir();
const PORT = process.env.BASE04_PORT || "55432";
const KEEP = process.env.KEEP === "1";
const USER_GUC = process.argv.includes("--user-guc");

function sh(cmd) { return execSync(cmd, { stdio: ["ignore", "pipe", "pipe"], shell: "cmd.exe" }).toString(); }
function psql(sql) {
  const f = path.join(SCRATCH, "base04-step.sql");
  fs.writeFileSync(f, sql);
  return sh(`docker exec -i ${NAME} psql -v ON_ERROR_STOP=1 -U postgres -d postgres -q < "${f}"`);
}

const stubBodies = USER_GUC
  ? `CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon') $$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
$$ SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}'::text)::jsonb $$;`
  : `CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT 'anon'::text $$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{}'::jsonb $$;`;

const hostedGrants = USER_GUC
  ? `-- Hosted-platform parity (documented prelude decision, NOT a migration):
-- Supabase grants table privileges to the platform roles at project
-- creation, independent of the folder; row filtering is then done by
-- the RLS predicates themselves. service_role bypasses RLS on hosted.
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
ALTER ROLE service_role BYPASSRLS;`
  : ``;

const PRELUDE = `-- Minimal Supabase-compatible prelude for a fresh NON-supabase postgres.
-- Platform roles the repo's grants expect + auth schema stubs.
-- Stub mode: ${USER_GUC ? "JWT-GUC-reading (RLS exercisable)" : "null (RLS parses, denies by default)"}.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE ROLE ssl NOLOGIN;
CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
${stubBodies}
-- The drill connects as postgres; allow it to SET ROLE to the platform
-- roles so RLS runs under the exact grantee the policies name.
GRANT anon, authenticated, service_role TO postgres;
${hostedGrants}
`;

function sanity() {
  const raw = execSync(`docker exec ${NAME} psql -U postgres -d postgres -t -A -c "SELECT json_build_object('tables',(SELECT count(*) FROM information_schema.tables WHERE table_schema='public'),'rls_enabled',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relrowsecurity),'policies',(SELECT count(*) FROM pg_policies WHERE schemaname='public'),'enums',(SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typtype='e'),'functions',(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'))::text"`).toString().trim();
  return JSON.parse(raw);
}

function main() {
  try { sh(`docker rm -f ${NAME}`); } catch { /* not running */ }
  sh(`docker run -d --name ${NAME} -e POSTGRES_PASSWORD=proof -p 127.0.0.1:${PORT}:5432 ${IMAGE}`);
  const deadline = Date.now() + 120_000;
  for (;;) {
    try { sh(`docker exec ${NAME} pg_isready -U postgres`); break; } catch { if (Date.now() > deadline) throw new Error("container not ready"); }
  }
  psql(PRELUDE);
  console.log(`prelude applied (user-guc=${USER_GUC})`);
  const files = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
  const applied = []; const failed = [];
  const local = path.join(SCRATCH, "base04-migration.sql");
  for (const file of files) {
    fs.copyFileSync(path.join(MIGRATIONS, file), local);
    try { sh(`docker exec -i ${NAME} psql -v ON_ERROR_STOP=1 -U postgres -d postgres -q < "${local}"`); applied.push(file); }
    catch (err) { failed.push({ file, error: String(err.message).split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 3).join(" | ") }); console.log(`FAILED: ${file}`); }
  }
  const result = { image: IMAGE, userGuc: USER_GUC, migrations: files.length, applied: applied.length, failed, sanity: sanity() };
  console.log(JSON.stringify({ appliedCount: result.applied, failedCount: failed.length, sanity: result.sanity }));
  fs.writeFileSync(path.join(SCRATCH, "base04-result.json"), JSON.stringify(result, null, 2));
  if (!KEEP) { sh(`docker rm -f ${NAME}`); console.log("container torn down"); }
  else console.log(`container KEPT: ${NAME} (port ${PORT})`);
  if (failed.length > 0) process.exit(1);
}
main();
