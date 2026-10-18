import { describe, expect, it } from "vitest"
import { getTableConfig } from "drizzle-orm/pg-core"
import { readFileSync } from "node:fs"
import { tournamentAwardDisputes } from "../schema/tournament-award-disputes"

const migration = readFileSync(new URL("../../../../supabase/migrations/20261018160000_award_disputes.sql", import.meta.url), "utf8")

describe("Award dispute schema and migration contracts (not real SQL execution)", () => {
  it("models the dispute record with the fixed vocabularies and provenance columns", () => {
    const config = getTableConfig(tournamentAwardDisputes)
    const column = (name: string) => config.columns.find(c => c.name === name)
    expect(column("award_id")?.notNull).toBe(true)
    expect(column("raised_by")?.notNull).toBe(true)
    expect(column("reason")?.notNull).toBe(true)
    expect(column("status")?.default).toBe("open")
    expect(column("resolved_at")?.notNull).toBe(false)
    expect(column("resolved_by")?.notNull).toBe(false)
    // Composite same-league anchor columns.
    expect(column("tournament_id")?.notNull).toBe(true)
    expect(column("tenant_id")?.notNull).toBe(true)
  })

  it("declares database constraints rather than trusting the writer alone", () => {
    expect(migration).toContain("CREATE TYPE public.award_dispute_reason AS ENUM ('incorrect_winner', 'winner_ineligible', 'process_error', 'other')")
    expect(migration).toContain("CREATE TYPE public.award_dispute_status AS ENUM ('open', 'upheld', 'dismissed')")
    expect(migration).toContain("tournament_award_disputes_resolution_check")
    expect(migration).toContain("CHECK (")
    expect(migration).toContain("status = 'open' AND resolved_at IS NULL AND resolved_by IS NULL")
    expect(migration).toContain("status IN ('upheld', 'dismissed') AND resolved_at IS NOT NULL AND resolved_by IS NOT NULL")
    expect(migration).toContain("REFERENCES public.tournament_awards(id) ON DELETE CASCADE")
    expect(migration).toContain("tournament_award_disputes_match_tenant_fk")
    expect(migration).toContain("REFERENCES public.tournaments(id, tenant_id) ON DELETE CASCADE")
  })

  it("pins one OPEN dispute per member per award as a database guarantee", () => {
    expect(migration).toContain("CREATE UNIQUE INDEX IF NOT EXISTS tournament_award_disputes_one_open_per_member_key")
    expect(migration).toContain("ON public.tournament_award_disputes (award_id, raised_by) WHERE status = 'open'")
    // Decided disputes never block a fresh, differently-founded challenge:
    // the uniqueness is PARTIAL, not total.
    expect(migration).not.toContain("CREATE UNIQUE INDEX IF NOT EXISTS tournament_award_disputes_award_raised_key")
  })

  it("adds the same-league composite anchor idempotently (teams_id_tenant_key house pattern)", () => {
    expect(migration).toContain("ADD CONSTRAINT tournaments_id_tenant_key UNIQUE (id, tenant_id)")
    expect(migration).toContain("EXCEPTION WHEN duplicate_object THEN NULL")
  })

  it("keeps the migration additive, idempotent and non-destructive", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.tournament_award_disputes")
    expect(migration).toContain("CREATE INDEX IF NOT EXISTS")
    expect(migration).toContain("BEGIN;")
    expect(migration.trim()).toMatch(/COMMIT;$/)
    expect(migration).not.toMatch(/DROP TABLE|DELETE FROM|TRUNCATE/i)
  })

  it("only the platform may read or write disputes; PostgREST clients cannot", () => {
    expect(migration).toContain("ENABLE ROW LEVEL SECURITY")
    expect(migration).toContain("FORCE ROW LEVEL SECURITY")
    expect(migration).toContain("REVOKE ALL ON public.tournament_award_disputes FROM PUBLIC, anon, authenticated")
    expect(migration).toContain("GRANT SELECT, INSERT, UPDATE ON public.tournament_award_disputes TO service_role")
    expect(migration).not.toMatch(/GRANT[\s\S]*?TO\s+anon/i)
    expect(migration).not.toMatch(/GRANT[\s\S]*?TO\s+authenticated/i)
  })
})
