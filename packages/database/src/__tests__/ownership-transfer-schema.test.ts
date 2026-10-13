import { describe, expect, it } from "vitest"
import { getTableConfig } from "drizzle-orm/pg-core"
import { readFileSync } from "node:fs"
import { ownershipTransfers } from "../schema/ownership-transfers"

const migration = readFileSync(new URL("../../../../supabase/migrations/20261013180000_ownership_transfers.sql", import.meta.url), "utf8")

describe("Two-party ownership transfer schema and migration contracts (not real SQL execution)", () => {
  it("models a pending request with an explicit lifecycle and version", () => {
    const config = getTableConfig(ownershipTransfers)
    const column = (name: string) => config.columns.find(c => c.name === name)
    expect(column("status")?.default).toBe("pending")
    expect(column("status")?.notNull).toBe(true)
    expect(column("version")?.default).toBe(0)
    expect(column("version")?.notNull).toBe(true)
    expect(column("demoted_role")?.default).toBe("team_manager")
    expect(column("expires_at")?.notNull).toBe(true)
  })

  it("declares database constraints rather than trusting the enum type alone", () => {
    const checks = getTableConfig(ownershipTransfers).checks.map(check => check.name).sort()
    expect(checks).toEqual([
      "ownership_transfers_demoted_role_check",
      "ownership_transfers_distinct_check",
      "ownership_transfers_status_check",
      "ownership_transfers_version_check",
    ])
    expect(migration).toContain("CHECK (status IN ('pending', 'accepted', 'cancelled', 'expired'))")
    expect(migration).toContain("CHECK (from_user_id <> to_user_id)")
    expect(migration).toContain("CHECK (demoted_role NOT IN ('league_owner', 'super_admin'))")
  })

  it("allows at most one open request per league via a partial unique index", () => {
    const indexes = getTableConfig(ownershipTransfers).indexes
    const pending = indexes.find(index => index.config.name === "ownership_transfers_pending_key")
    expect(pending?.config.unique).toBe(true)
    // The uniqueness only applies to the open request; history is unconstrained.
    expect(pending?.config.where).toBeDefined()
    expect(migration).toContain("CREATE UNIQUE INDEX IF NOT EXISTS ownership_transfers_pending_key")
    expect(migration).toContain("WHERE status = 'pending'")
  })

  it("keeps the migration additive, idempotent and non-destructive", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.ownership_transfers")
    expect(migration).toContain("DROP CONSTRAINT IF EXISTS")
    expect(migration).toContain("CREATE INDEX IF NOT EXISTS")
    expect(migration).toContain("BEGIN;")
    expect(migration.trim()).toMatch(/COMMIT;$/)
    expect(migration).not.toMatch(/DROP TABLE|DELETE FROM|TRUNCATE/i)
  })

  it("only the platform may read or write transfers; PostgREST clients cannot", () => {
    expect(migration).toContain("ENABLE ROW LEVEL SECURITY")
    expect(migration).toContain("FORCE ROW LEVEL SECURITY")
    expect(migration).toContain("REVOKE ALL ON TABLE public.ownership_transfers FROM anon")
    expect(migration).toContain("REVOKE ALL ON TABLE public.ownership_transfers FROM authenticated")
    expect(migration).toContain("GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ownership_transfers TO service_role")
    expect(migration).not.toMatch(/GRANT[\s\S]*?TO\s+anon/i)
    expect(migration).not.toMatch(/GRANT[\s\S]*?TO\s+authenticated/i)
  })
})
