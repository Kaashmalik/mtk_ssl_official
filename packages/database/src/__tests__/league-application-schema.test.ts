import { describe, expect, it } from "vitest"
import { getTableConfig } from "drizzle-orm/pg-core"
import { readFileSync } from "node:fs"
import { leagueApplications } from "../schema/league-applications"
import { LEAGUE_APPLICATION_STATES } from "../lib/league-application-policy"

const migration = readFileSync(
  new URL("../../../../supabase/migrations/20261017130000_league_applications.sql", import.meta.url),
  "utf8",
)

/** Drizzle types index columns loosely; read the table column names defensively. */
function columnNames(columns: unknown): string[] {
  return (columns as { name?: string }[]).map((column) => column.name ?? "")
}

describe("League application schema and migration contracts (not real SQL execution)", () => {
  it("models one reviewed application with an explicit lifecycle and version", () => {
    const config = getTableConfig(leagueApplications)
    const column = (name: string) => config.columns.find((c) => c.name === name)
    expect(column("state")?.default).toBe("draft")
    expect(column("state")?.notNull).toBe(true)
    expect(column("version")?.default).toBe(0)
    expect(column("version")?.notNull).toBe(true)
    expect(column("desired_plan")?.default).toBe("free")
    expect(column("desired_plan")?.notNull).toBe(true)
    expect(column("provisioned_tenant_id")?.notNull).toBe(false)
    expect(column("review_reason")?.notNull).toBe(false)
    expect(column("reviewed_by")?.notNull).toBe(false)
    expect(column("submitted_at")?.notNull).toBe(false)
  })

  it("declares database constraints rather than trusting the enum type alone", () => {
    const checks = getTableConfig(leagueApplications).checks.map((check) => check.name).sort()
    expect(checks).toEqual([
      "league_applications_name_check",
      "league_applications_slug_check",
      "league_applications_state_check",
      "league_applications_version_check",
    ])
    expect(migration).toContain(`CHECK (state IN ('${LEAGUE_APPLICATION_STATES.join("', '")}'))`)
    expect(migration).toContain("CHECK (version >= 0)")
    expect(migration).toContain("CHECK (char_length(proposed_name) BETWEEN 2 AND 120)")
    expect(migration).toContain(`CHECK (proposed_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')`)
  })

  it("keeps the state vocabulary in sync with the shared policy module", () => {
    // The policy is the single source of the vocabulary; the schema check and
    // the active-slot index must both speak it.
    const config = getTableConfig(leagueApplications)
    const stateCheck = config.checks.find((check) => check.name === "league_applications_state_check")
    expect(stateCheck).toBeDefined()
    for (const state of LEAGUE_APPLICATION_STATES) {
      expect(migration).toContain(state)
    }
    expect(migration).toContain("WHERE state IN ('draft', 'submitted', 'needs_information')")
  })

  it("allows at most one active application per applicant via a partial unique index", () => {
    const indexes = getTableConfig(leagueApplications).indexes
    const active = indexes.find((index) => index.config.name === "league_applications_active_key")
    expect(active?.config.unique).toBe(true)
    expect(active?.config.where).toBeDefined()
    expect(columnNames(active?.config.columns)).toEqual(["applicant_id"])
    expect(migration).toContain("CREATE UNIQUE INDEX IF NOT EXISTS league_applications_active_key")
  })

  it("allows at most one application to provision a tenant via a partial unique index", () => {
    const indexes = getTableConfig(leagueApplications).indexes
    const provisioned = indexes.find((index) => index.config.name === "league_applications_provisioned_key")
    expect(provisioned?.config.unique).toBe(true)
    expect(provisioned?.config.where).toBeDefined()
    expect(columnNames(provisioned?.config.columns)).toEqual(["provisioned_tenant_id"])
    expect(migration).toContain("CREATE UNIQUE INDEX IF NOT EXISTS league_applications_provisioned_key")
    expect(migration).toContain("WHERE provisioned_tenant_id IS NOT NULL")
  })

  it("indexes the platform review queue by state and age", () => {
    const indexes = getTableConfig(leagueApplications).indexes
    const queue = indexes.find((index) => index.config.name === "idx_league_applications_queue")
    expect(columnNames(queue?.config.columns)).toEqual(["state", "created_at"])
    expect(migration).toContain("CREATE INDEX IF NOT EXISTS idx_league_applications_queue")
  })

  it("keeps the migration additive, idempotent and non-destructive", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.league_applications")
    expect(migration).toContain("DROP CONSTRAINT IF EXISTS")
    expect(migration).toContain("CREATE INDEX IF NOT EXISTS")
    expect(migration).toContain("BEGIN;")
    expect(migration.trim()).toMatch(/COMMIT;$/)
    expect(migration).not.toMatch(/DROP TABLE|DELETE FROM|TRUNCATE/i)
  })

  it("only the platform may read or write applications; PostgREST clients cannot", () => {
    expect(migration).toContain("ENABLE ROW LEVEL SECURITY")
    expect(migration).toContain("FORCE ROW LEVEL SECURITY")
    expect(migration).toContain("REVOKE ALL ON TABLE public.league_applications FROM anon")
    expect(migration).toContain("REVOKE ALL ON TABLE public.league_applications FROM authenticated")
    expect(migration).toContain("GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.league_applications TO service_role")
    expect(migration).not.toMatch(/GRANT[\s\S]*?TO\s+anon/i)
    expect(migration).not.toMatch(/GRANT[\s\S]*?TO\s+authenticated/i)
  })
})
