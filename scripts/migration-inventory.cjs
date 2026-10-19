#!/usr/bin/env node
/**
 * BASE-04 (Batch 146): migration inventory and reconciliation.
 *
 * Part of the deployed-schema evidence chain: the migrations FOLDER is the
 * source of truth for what SHOULD exist; supabase/MIGRATION_STATUS.md is
 * the human register; the live database is what actually exists. This tool
 * reconciles the first against either of the other two and reports drift
 * in the only honest directions:
 *   - missing-in-db   : a migration file with no record that it was applied.
 *   - untracked-in-db : the database/registry contains a migration the
 *                       folder does not - always flagged, never normalized.
 *
 * Modes:
 *   --manifest       Print the expected inventory (file, stamp, name) as
 *                    JSON. No database, no environment: fully deterministic
 *                    and safe for CI.
 *   --registry       Reconcile the folder against supabase/MIGRATION_STATUS.md
 *                    entries (pure text, still no database).
 *   --db             Additionally reconcile against the live database via
 *                    DATABASE_URL (supabase_migrations.schema_migrations).
 *                    OFF by default; never connects unless explicitly asked.
 *
 * Exit codes: 0 = no drift; 1 = drift found; 2 = usage/environment error.
 */
const fs = require("fs")
const path = require("path")

const ROOT = path.resolve(__dirname, "..")
const MIGRATIONS_DIR = path.join(ROOT, "supabase", "migrations")
const STATUS_FILE = path.join(ROOT, "supabase", "MIGRATION_STATUS.md")

/** The expected inventory, derived ONLY from the migrations folder. */
function buildManifest() {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((file) => {
      // Two historical naming shapes exist in this repo: 3-digit legacy
      // prefixes (001_enable_uuid_v7_and_helpers) and 14-digit timestamps
      // (20261018220000_scorecard_correction_requests). Both are opaque
      // digit-stamps; lexicographic order is the order migrations run in.
      const match = /^(\d+)_(.+)\.sql$/.exec(file)
      if (!match) throw new Error(`Unparseable migration filename: ${file}`)
      return { file, stamp: match[1], name: match[2] }
    })
}

/** Migration stamps recorded in MIGRATION_STATUS.md (applied-remotely notes). */
function registryStamps() {
  const text = fs.readFileSync(STATUS_FILE, "utf8")
  const stamps = new Set()
  // Both register shapes: the bare stamp in backticks and the full
  // filename in backticks (original-stamp provenance lines).
  for (const match of text.matchAll(/`(\d{14})(?:_[a-z0-9_]+)?`/g)) stamps.add(match[1])
  return stamps
}

/**
 * Pure three-way reconcile. Kept pure so the drift rules are testable
 * without a database - the db runner below only feeds it rows.
 *
 * seenInDb items may be plain stamps (legacy shape, used by tests) or
 * {version, name} rows: the deployed ledger records a NAME column, and
 * some batches were legitimately applied under a different stamp with
 * the same name, so a migration counts as deployed when EITHER its
 * folder stamp or its file-name suffix was recorded. Stamp-only
 * matching faked drift that the schema did not have.
 */
function reconcile(expected, seenInRegistry, seenInDb, seenInDbNames = []) {
  const registry = new Set(seenInRegistry)
  const dbRows = new Map()
  for (const item of seenInDb) {
    if (item !== null && typeof item === "object") dbRows.set(String(item.version), item.name ?? null)
    else dbRows.set(String(item), null)
  }
  for (const item of seenInDbNames) {
    if (item !== null && typeof item === "object") {
      if (!dbRows.has(String(item.version))) dbRows.set(String(item.version), item.name ?? null)
    } else if (!dbRows.has(String(item))) dbRows.set(String(item), String(item))
  }
  const expectedStamps = new Set(expected.map((m) => m.stamp))
  const expectedNames = new Set(expected.map((m) => m.name))
  const isDeployed = (m) =>
    [...dbRows.entries()].some(([version, name]) => version === m.stamp || (name !== null && name === m.name))
  const rows = expected.map((m) => ({
    ...m,
    registry: registry.has(m.stamp),
    db: isDeployed(m),
  }))
  const untracked = [...dbRows.entries()]
    .filter(([version, name]) => !expectedStamps.has(version) && (name === null || !expectedNames.has(name)))
    .map(([version]) => version)
    .sort()
  return {
    rows,
    drift: {
      missingInDb: rows.filter((r) => !r.db).map((r) => r.stamp),
      untrackedInDb: untracked,
      pendingInRegistry: rows.filter((r) => !r.registry).map((r) => r.stamp),
    },
  }
}

/** Reads applied stamps from the live Supabase migrations table. Never called in --manifest/--registry modes. */
async function dbAppliedStamps() {
  if (!process.env.DATABASE_URL) throw new Error("--db requires DATABASE_URL")
  // Use the repo's established driver (postgres, a packages/database
  // dependency) instead of adding a second pg client to the tree.
  const dbPkg = require("path").join(__dirname, "..", "packages", "database")
  const postgres = require(require.resolve("postgres", { paths: [dbPkg] }))
  const sql = postgres(process.env.DATABASE_URL, { max: 1, ssl: "prefer", connect_timeout: 30 })
  try {
    const result = await sql`SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version`
    return result.map((r) => ({ version: String(r.version), name: r.name ?? null }))
  } finally {
    await sql.end({ timeout: 5 })
  }
}

function main(args) {
  const manifest = buildManifest()
  if (args.includes("--manifest")) {
    console.log(JSON.stringify({ source: "supabase/migrations", count: manifest.length, migrations: manifest }, null, 2))
    return 0
  }
  const useRegistry = args.includes("--registry") || args.includes("--db")
  const seenRegistry = useRegistry ? [...registryStamps()] : []
  if (!args.includes("--db")) {
    // Folder vs registry only; no database is ever touched. Informational:
    // the register only documents batches since the Oct 6 hardening pass,
    // so legacy stamps legitimately show as unregistered. Exit 0 either
    // way - the DEPLOYED-schema gate is the --db reconciliation.
    const reconciled = reconcile(manifest, seenRegistry, [])
    console.log(
      JSON.stringify(
        { count: manifest.length, registry: useRegistry, drift: reconciled.drift, note: "registry mode is informational; use --db for the deployed-schema gate" },
        null, 2,
      ),
    )
    return 0
  }
  return dbAppliedStamps().then((stamps) => {
    const reconciled = reconcile(manifest, seenRegistry, stamps)
    console.log(
      JSON.stringify({ count: manifest.length, registry: useRegistry, db: true, drift: reconciled.drift }, null, 2),
    )
    const realDrift =
      reconciled.drift.missingInDb.length > 0 || reconciled.drift.untrackedInDb.length > 0
    return realDrift ? 1 : 0
  })
}

if (require.main === module) {
  Promise.resolve(main(process.argv.slice(2)))
    .then((code) => process.exit(code ?? 0))
    .catch((err) => {
      console.error(`migration-inventory: ${err.message}`)
      process.exit(2)
    })
}

module.exports = { buildManifest, registryStamps, reconcile }
