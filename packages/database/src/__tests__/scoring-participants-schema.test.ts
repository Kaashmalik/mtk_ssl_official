import { describe, expect, it } from "vitest"
import { getTableConfig } from "drizzle-orm/pg-core"
import { readFileSync } from "node:fs"
import { matchBalls } from "../schema/match-balls"

/**
 * Batch 100 (ENH-03-02 / ENH-09-02): wicket-attribution schema discipline.
 *
 * Static pin, no SQL executed: the additive migration and the Drizzle
 * definitions must agree that attribution is optional, references the owning
 * tenant's players (never deleting them), and is documented as scorer-declared
 * data validated by the canonical service - not platform-derived.
 */

const migration = readFileSync(
  new URL("../../../../supabase/migrations/20261022120000_scoring_wicket_attribution.sql", import.meta.url),
  "utf8",
)

describe("Batch 100: wicket attribution schema", () => {
  it("adds exactly the two optional attribution columns to match_balls", () => {
    const config = getTableConfig(matchBalls)
    const playerOut = config.columns.find(column => column.name === "wicket_player_out_id")
    const fielder = config.columns.find(column => column.name === "wicket_fielder_id")
    expect(playerOut?.notNull).toBe(false)
    expect(fielder?.notNull).toBe(false)
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS wicket_player_out_id uuid")
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS wicket_fielder_id uuid")
  })

  it("references players with ON DELETE SET NULL (attribution never deletes a player)", () => {
    expect(migration).toContain(
      "wicket_player_out_id uuid\n    REFERENCES public.players (id) ON DELETE SET NULL",
    )
    expect(migration).toContain(
      "wicket_fielder_id uuid\n    REFERENCES public.players (id) ON DELETE SET NULL",
    )
  })

  it("documents the LOCAL ONLY gate order: migration first, flag after", () => {
    expect(migration).toContain("LOCAL ONLY")
    expect(migration).toContain("SCORING_PARTICIPANTS_READY=true")
    // Both statements are idempotent so re-applying cannot damage state.
    expect(migration).toContain("BEGIN;")
    expect(migration).toContain("COMMIT;")
  })

  it("records why the columns exist: attribution the service already validated was dropped", () => {
    expect(migration).toContain("persisted only `wicket_type`")
    expect(migration).toContain("silently dropped")
  })
})
