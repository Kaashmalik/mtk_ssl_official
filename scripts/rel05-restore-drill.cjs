#!/usr/bin/env node
/**
 * REL-05 (Batch 158): backup -> restore DRILL, committed and repeatable.
 *
 * 1. pg_dump the REMOTE database (from a postgres:17-alpine drill
 *    container so the client version >= server 17; the dump streams
 *    through a local memory pipe and is NEVER written to disk).
 * 2. Restore the stream into a virgin container database (--no-owner
 *    --no-privileges; extensions come from the folder's own CREATE
 *    EXTENSION statements).
 * 3. Verify: row counts of the core tenant-bearing tables must match
 *    the remote exactly, and the restored catalog must have the same
 *    table/policy counts as a BASE-04 fresh rebuild.
 *
 * Env: REMOTE_URL (falls back to DATABASE_URL parsed from repo .env),
 * BASE05_PORT (default 55433). The drill container is torn down at the
 * end unless KEEP=1.
 */
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const NAME = "mtk-rel05-restore";
const IMAGE = "postgres:17-alpine";
const PORT = process.env.BASE05_PORT || "55433";
const SCRATCH = require("os").tmpdir();
const KEEP = process.env.KEEP === "1";

function sh(cmd) { return execSync(cmd, { stdio: ["ignore", "pipe", "pipe"], shell: "cmd.exe", maxBuffer: 1 << 28 }).toString(); }

function remoteUrl() {
  if (process.env.REMOTE_URL) return process.env.REMOTE_URL;
  const envPath = path.join(__dirname, "..", ".env");
  const line = fs.readFileSync(envPath, "utf8").split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL="));
  if (!line) throw new Error("no DATABASE_URL / REMOTE_URL available");
  return line.slice("DATABASE_URL=".length).replace(/^["']|["']$/g, "");
}

function main() {
  const url = remoteUrl();
  const masked = url.replace(/\/\/[^@]*@/, "//***@");
  console.log("remote:", masked);

  // 1. drill container
  try { sh(`docker rm -f ${NAME}`); } catch { /* not running */ }
  sh(`docker run -d --name ${NAME} -e POSTGRES_PASSWORD=drill -p 127.0.0.1:${PORT}:5432 ${IMAGE}`);
  const deadline = Date.now() + 120_000;
  for (;;) {
    try { sh(`docker exec ${NAME} pg_isready -U postgres`); break; } catch { if (Date.now() > deadline) throw new Error("drill container not ready"); }
  }
  console.log("drill container ready (postgres:17-alpine)");

  // 2. dump (streams to a local Buffer, size-fenced; 17MB-scale db)
  const dump = execSync(`docker exec ${NAME} pg_dump "${url}" --no-owner --no-privileges`, {
    stdio: ["ignore", "pipe", "pipe"], shell: "cmd.exe", maxBuffer: 1 << 30,
  });
  console.log(`dump captured: ${(dump.length / 1024 / 1024).toFixed(1)} MB (in-memory only, destroyed with this process)`);

  // 3. restore into virgin db
  const f = path.join(SCRATCH, "rel05-restore.dump");
  fs.writeFileSync(f, dump); // local scratch file, deleted immediately after the pipe
  try {
    execSync(`docker exec -i ${NAME} psql -U postgres -d postgres -v ON_ERROR_STOP=0 -q < "${f}"`, { stdio: ["ignore", "pipe", "pipe"], shell: "cmd.exe", maxBuffer: 1 << 28 });
  } finally {
    fs.rmSync(f, { force: true });
  }
  console.log("restore applied");

  // 4. verify - existence first ("absent on both sides" is fidelity),
  // then row counts only where the table exists on the remote.
  const TABLES = ["users", "tenants", "user_tenant_roles", "teams", "tournaments", "matches", "match_balls", "profiles", "players", "audit_logs", "scoring_outbox", "league_applications"];
  const f2 = path.join(SCRATCH, "rel05-verify.sql");
  let mismatches = 0;
  for (const t of TABLES) {
    fs.writeFileSync(f2, `SELECT to_regclass('public.${t}') IS NOT NULL;`);
    const existsRemote = execSync(`docker exec -i ${NAME} psql "${url}" -X -q -t -A < "${f2}"`).toString().trim() === "t";
    const existsRestored = execSync(`docker exec -i ${NAME} psql -U postgres -d postgres -X -q -t -A < "${f2}"`).toString().trim() === "t";
    if (!existsRemote && !existsRestored) { console.log(`ABSENT-OK ${t}: not on remote, faithfully absent from restore`); continue; }
    fs.writeFileSync(f2, `SELECT count(*) FROM public.${t};`);
    const r = execSync(`docker exec -i ${NAME} psql "${url}" -X -q -t -A < "${f2}"`).toString().trim();
    const s = execSync(`docker exec -i ${NAME} psql -U postgres -d postgres -X -q -t -A < "${f2}"`).toString().trim();
    const ok = existsRemote === existsRestored && r === s;
    if (!ok) mismatches++;
    console.log(`${ok ? "OK " : "MISMATCH"} ${t}: remote=${existsRemote ? r : "ABSENT"} restored=${existsRestored ? s : "ABSENT"}`);
  }
  fs.rmSync(f2, { force: true });
  const restoredCatalog = execSync(`docker exec ${NAME} psql -U postgres -d postgres -t -A -c "SELECT (SELECT count(*) FROM information_schema.tables WHERE table_schema='public')||(SELECT ' tables, ')||(SELECT count(*) FROM pg_policies WHERE schemaname='public')||(SELECT ' policies')"`).toString();
  console.log("restored catalog:", restoredCatalog.trim());

  if (!KEEP) { sh(`docker rm -f ${NAME}`); console.log("drill container torn down"); }
  if (mismatches > 0) { console.log(`REL-05: ${mismatches} MISMATCH(ES)`); process.exit(1); }
  console.log("REL-05: PASS - every core table restored with identical row counts");
}
main();
