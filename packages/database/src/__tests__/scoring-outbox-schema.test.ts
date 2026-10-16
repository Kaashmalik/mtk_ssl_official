import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { getTableConfig } from "drizzle-orm/pg-core"
import { scoringOutbox } from "../schema/scoring-outbox"
import { matches } from "../schema/matches"

const migration = readFileSync(new URL("../../../../supabase/migrations/20261016102316_scoring_transactional_outbox.sql", import.meta.url), "utf8")
describe("Internal scoring outbox schema contracts (not executed PostgreSQL)", () => {
  it("enforces same-league match parentage at the database level", () => {
    const key = getTableConfig(scoringOutbox).foreignKeys[0].reference()
    expect(key.columns.map(column => column.name)).toEqual(["match_id", "tenant_id"])
    expect(key.foreignColumns.map(column => column.name)).toEqual(["id", "tenant_id"])
    expect(getTableConfig(matches).indexes.some(index => index.config.name === "matches_id_tenant_key")).toBe(true)
    expect(migration).toContain("REFERENCES public.matches(id, tenant_id) ON DELETE RESTRICT")
  })
  it("deduplicates durable event identities and indexes pending match predecessors", () => {
    const indexes = getTableConfig(scoringOutbox).indexes.map(index => index.config.name)
    expect(indexes).toContain("scoring_outbox_event_key")
    expect(indexes).toContain("scoring_outbox_match_pending_idx")
    expect(migration).toContain("WHERE delivered_at IS NULL")
  })
  it("enforces envelope tenant/match/event bindings, topics and nonnegative attempts", () => {
    expect(getTableConfig(scoringOutbox).checks.map(check => check.name)).toEqual([
      "scoring_outbox_attempts_check", "scoring_outbox_topic_check", "scoring_outbox_envelope_check",
    ])
    expect(migration).toContain("payload->>'tenantId' IS NOT NULL")
    expect(migration).toContain("payload->>'tenantId' = tenant_id::text")
    expect(migration).toContain("payload->>'matchId' = match_id::text")
    expect(migration).toContain("payload->>'eventId' = event_id")
  })
  it("denies anonymous/member access to both journal and sequence", () => {
    expect(migration).toContain("ENABLE ROW LEVEL SECURITY")
    expect(migration).toContain("FORCE ROW LEVEL SECURITY")
    expect(migration).toContain("REVOKE ALL ON public.scoring_outbox FROM PUBLIC, anon, authenticated")
    expect(migration).toContain("REVOKE ALL ON SEQUENCE public.scoring_outbox_id_seq FROM PUBLIC, anon, authenticated")
    expect(migration).not.toMatch(/GRANT.*TO (?:anon|authenticated)/)
    expect(migration).not.toContain("SECURITY DEFINER")
  })
  it("is additive/atomic and never purges pending events or grants runtime DELETE", () => {
    expect(migration).toContain("BEGIN;")
    expect(migration.trim()).toMatch(/COMMIT;$/)
    expect(migration).not.toMatch(/DROP TABLE|TRUNCATE|DELETE FROM|GRANT .*DELETE/)
    expect(scoringOutbox.deliveredAt.notNull).toBe(false)
  })
})
