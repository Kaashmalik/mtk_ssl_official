import { describe, expect, it } from "vitest"
import { getTableConfig } from "drizzle-orm/pg-core"
import { readFileSync } from "node:fs"
import { tournamentPrizes } from "../schema/tournament-prizes"

const migration = readFileSync(new URL("../../../../supabase/migrations/20261017160000_tournament_prizes.sql", import.meta.url), "utf8")
const supersedeMigration = readFileSync(new URL("../../../../supabase/migrations/20261017170000_prize_supersede.sql", import.meta.url), "utf8")

describe("Tournament prize schema and migration contracts (not real SQL execution)", () => {
  it("models configurable categories with a draft-default lifecycle and money columns", () => {
    const config = getTableConfig(tournamentPrizes)
    const column = (name: string) => config.columns.find(c => c.name === name)
    expect(column("category_name")?.notNull).toBe(true)
    expect(column("status")?.default).toBe("draft")
    expect(column("status")?.notNull).toBe(true)
    // Currency has a safe default; the amount itself is nullable (non-cash prizes).
    expect(column("currency")?.default).toBe("PKR")
    expect(column("amount")?.notNull).toBe(false)
    expect(column("recorded_payout_at")?.notNull).toBe(false)
  })

  it("declares database constraints rather than trusting the enum type alone", () => {
    expect(migration).toContain("CREATE TYPE public.tournament_prize_status AS ENUM ('draft', 'approved')")
    expect(migration).toContain("tournament_prizes_approval_provenance_check")
    expect(migration).toContain("CHECK (status <> 'approved' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL))")
    expect(migration).toContain("tournament_prizes_payout_requires_approval_check")
    expect(migration).toContain("CHECK (recorded_payout_at IS NULL OR status = 'approved')")
    expect(migration).toContain("tournament_prizes_amount_check")
    expect(migration).toContain("CHECK (amount IS NULL OR (amount >= 0 AND amount <= 9999999999.99))")
  })

  it("keeps the migration additive, idempotent and non-destructive", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.tournament_prizes")
    expect(migration).toContain("CREATE INDEX IF NOT EXISTS")
    expect(migration).toContain("BEGIN;")
    expect(migration.trim()).toMatch(/COMMIT;$/)
    expect(migration).not.toMatch(/DROP TABLE|DELETE FROM|TRUNCATE/i)
  })

  it("only the platform may read or write prizes; PostgREST clients cannot", () => {
    expect(migration).toContain("ENABLE ROW LEVEL SECURITY")
    expect(migration).toContain("FORCE ROW LEVEL SECURITY")
    expect(migration).toContain("REVOKE ALL ON public.tournament_prizes FROM PUBLIC, anon, authenticated")
    expect(migration).toContain("GRANT SELECT, INSERT, UPDATE ON public.tournament_prizes TO service_role")
    expect(migration).not.toMatch(/GRANT[\s\S]*?TO\s+anon/i)
    expect(migration).not.toMatch(/GRANT[\s\S]*?TO\s+authenticated/i)
  })

  it("models supersede provenance so approved-prize corrections append history", () => {
    const config = getTableConfig(tournamentPrizes)
    const column = (name: string) => config.columns.find(c => c.name === name)
    expect(column("superseded_at")?.notNull).toBe(false)
    expect(column("superseded_by_prize_id")?.notNull).toBe(false)
    // The index mirrors the drizzle schema's (tournament_id, superseded_at).
    const indexNames = config.indexes.map((i: any) => i.config?.name ?? i.name)
    expect(indexNames).toContain("tournament_prizes_superseded_idx")
  })

  it("keeps the supersede migration idempotent, cohesive and non-destructive", () => {
    expect(supersedeMigration).toContain("ADD COLUMN IF NOT EXISTS superseded_at timestamptz")
    expect(supersedeMigration).toContain("ADD COLUMN IF NOT EXISTS superseded_by_prize_id uuid")
    expect(supersedeMigration).toContain("REFERENCES public.tournament_prizes(id) ON DELETE SET NULL")
    expect(supersedeMigration).toContain("tournament_prizes_supersede_cohesion_check")
    expect(supersedeMigration).toContain("CHECK ((superseded_at IS NULL) = (superseded_by_prize_id IS NULL))")
    expect(supersedeMigration).toContain("CREATE INDEX IF NOT EXISTS tournament_prizes_superseded_idx")
    expect(supersedeMigration).toContain("BEGIN;")
    expect(supersedeMigration.trim()).toMatch(/COMMIT;$/)
    expect(supersedeMigration).not.toMatch(/DROP TABLE|DELETE FROM|TRUNCATE/i)
    expect(supersedeMigration).not.toMatch(/GRANT[\s\S]*?TO\s+(anon|authenticated)/i)
  })
})
