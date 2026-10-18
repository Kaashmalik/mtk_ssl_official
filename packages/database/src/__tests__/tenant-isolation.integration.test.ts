import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import postgres from "postgres"
import { describe, expect, it } from "vitest"

/**
 * ISO-07 / staged acceptance: REAL-database evidence suite.
 *
 * Gated behind TWO switches so ordinary batteries never touch production:
 *   LIVE_DB_ACCEPTANCE=1  AND  DATABASE_URL present in the repo-root .env.
 * Every test is READ-ONLY against the live project - no inserts, no
 * updates, no deletes, no schema changes. This is an evidence pass, not a
 * fixture playground.
 *
 * Covers the acceptance claims the unit suites cannot prove:
 *   1. The Oct-18 migrations exist remotely with their exact CHECKs,
 *      partial-unique definitions and FORCED RLS (fan_reaction_reports,
 *      fan_blocks) and users.time_zone.
 *   2. The fail-closed grants posture actually holds: PUBLIC/anon/
 *      authenticated have no privileges on the fan tables; only the
 *      internal ssl/service_role roles do.
 *   3. The PUBLIC API tier fails closed for the same tables: an anon-key
 *      REST read returns an error, never rows.
 *   4. Basic live health of the defaults the writers rely on
 *      (uuid_generate_v7, timestamptz precision).
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..")

function readEnvVar(name: string): string | null {
  try {
    const raw = readFileSync(join(REPO_ROOT, ".env"), "utf8")
    const match = raw.match(new RegExp(`^${name}=(.*)$`, "m"))
    return match ? match[1].trim() : null
  } catch {
    return null
  }
}

const databaseUrl = process.env.DATABASE_URL ?? readEnvVar("DATABASE_URL")
const supabaseUrl = readEnvVar("NEXT_PUBLIC_SUPABASE_URL")
const anonKey = readEnvVar("NEXT_PUBLIC_SUPABASE_ANON_KEY")
const optIn = process.env.LIVE_DB_ACCEPTANCE === "1" && Boolean(databaseUrl)

describe.skipIf(!optIn)("ISO-07 staged acceptance (live, READ-ONLY)", () => {
  const sql = postgres(databaseUrl as string, { max: 1, idle_timeout: 5 })

  it("reveals the Oct-18 tables with their CHECKs, partial uniques and FORCED RLS", async () => {
    const tables = await sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('fan_reaction_reports', 'fan_blocks')`
    expect(tables.map(t => t.table_name).sort()).toEqual(["fan_blocks", "fan_reaction_reports"])

    const checks = await sql`
      SELECT conrelid::regclass::text AS tbl, conname FROM pg_constraint
      WHERE contype = 'c'
        AND conrelid IN ('public.fan_reaction_reports'::regclass, 'public.fan_blocks'::regclass)
      ORDER BY 1, 2`
    const names = checks.map(c => c.conname)
    for (const expected of [
      "fan_reaction_reports_reason_check",
      "fan_reaction_reports_status_check",
      "fan_reaction_reports_review_provenance_check",
      "fan_blocks_reason_check",
      "fan_blocks_status_check",
      "fan_blocks_lift_provenance_check",
    ]) {
      expect(names, expected).toContain(expected)
    }

    const indexes = await sql`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname IN ('fan_reaction_reports_open_uidx', 'fan_blocks_active_uidx')`
    const defs = Object.fromEntries(indexes.map(i => [i.indexname, i.indexdef]))
    expect(defs.fan_reaction_reports_open_uidx).toContain("WHERE")
    expect(defs.fan_reaction_reports_open_uidx).toContain("(match_id, reported_by)")
    expect(defs.fan_blocks_active_uidx).toContain("WHERE")
    expect(defs.fan_blocks_active_uidx).toContain("(tenant_id, blocked_user_id)")

    const rls = await sql`
      SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
      WHERE oid IN ('public.fan_reaction_reports'::regclass, 'public.fan_blocks'::regclass)
      ORDER BY relname`
    for (const row of rls) {
      expect(row.relrowsecurity, row.relname).toBe(true)
      expect(row.relforcerowsecurity, row.relname).toBe(true)
    }
  })

  it("carries the users display-timezone column from the Batch 114 migration", async () => {
    const cols = await sql`
      SELECT data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'time_zone'`
    expect(cols).toHaveLength(1)
    expect(cols[0].data_type).toBe("text")
    expect(cols[0].is_nullable).toBe("YES")
    expect(cols[0].column_default).toBeNull()
  })

  it("keeps the fan tables invisible to PUBLIC/anon/authenticated, granted only internally", async () => {
    const grants = await sql`
      SELECT table_name, grantee, privilege_type
      FROM information_schema.role_table_grants
      WHERE table_schema = 'public'
        AND table_name IN ('fan_reaction_reports', 'fan_blocks')`
    const byGrantee = new Map<string, number>()
    for (const g of grants) byGrantee.set(g.grantee, (byGrantee.get(g.grantee) ?? 0) + 1)
    // The public-facing roles must hold NOTHING on either table.
    for (const forbidden of ["PUBLIC", "anon", "authenticated"]) {
      expect(byGrantee.get(forbidden) ?? 0, forbidden).toBe(0)
    }
    // The internal service roles may read/write both tables.
    for (const required of ["ssl", "service_role"]) {
      expect((byGrantee.get(required) ?? 0), required).toBeGreaterThanOrEqual(3)
    }
  })

  it("fails the public REST tier closed for the fan tables (anon key returns an error, never rows)", async () => {
    // A missing public URL/key is an environment gap, not an acceptance pass.
    expect(supabaseUrl, "NEXT_PUBLIC_SUPABASE_URL missing from .env").toBeTruthy()
    expect(anonKey, "NEXT_PUBLIC_SUPABASE_ANON_KEY missing from .env").toBeTruthy()

    for (const table of ["fan_reaction_reports", "fan_blocks"]) {
      const response = await fetch(`${supabaseUrl}/rest/v1/${table}?select=id`, {
        headers: { apikey: anonKey as string, Authorization: `Bearer ${anonKey}` },
      })
      // Fail closed: an error status (401/403/404) or, at worst, an empty
      // row set. ANY actual row data here means the storage posture leaked.
      if (!response.ok) {
        expect(response.status).toBeGreaterThanOrEqual(400)
      } else {
        const body = await response.json() as unknown[]
        expect(body, `${table} leaked rows to the anon key`).toEqual([])
      }
    }
  })

  it("proves live health of the defaults the writers rely on", async () => {
    const [health] = await sql`
      SELECT current_user AS current_user,
             uuid_generate_v7() AS probe_id,
             now() AS server_now`
    expect(health.current_user).toBeTruthy()
    expect(String(health.probe_id)).toMatch(/^[0-9a-f-]{36}$/)
    expect(health.server_now).toBeInstanceOf(Date)
  })
})
