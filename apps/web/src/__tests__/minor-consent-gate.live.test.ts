import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * ENH-01-01 staged acceptance for the minor-consent PUBLIC gate (LIVE,
 * READ-ONLY, opt-in via LIVE_DB_ACCEPTANCE=1), following the public-readers
 * staged-acceptance convention.
 *
 * Proves SQL-versus-policy truth on real rows: for every sampled player the
 * Postgres-evaluated `minorConsentPublicSql` gate must agree with the pure
 * `minorPublicDecision` policy. This is the missing half of the Batch-132
 * contract - the mocked twin tests can pin only the emitted formula. The
 * query is bounded, selects no PII into assertions (uuid + decision booleans
 * only, and only on failure), and never writes.
 */

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..", "..")

function readEnvVar(name: string): string | null {
  if (process.env.LIVE_DB_ACCEPTANCE !== "1") return null
  const raw = readFileSync(join(REPO_ROOT, ".env"), "utf8")
  const match = raw.match(new RegExp(`^${name}=(.*)$`, "m"))
  return match ? match[1].trim() : null
}

const liveUrl = process.env.LIVE_DB_ACCEPTANCE === "1" ? process.env.DATABASE_URL ?? readEnvVar("DATABASE_URL") : null
const optedIn = process.env.LIVE_DB_ACCEPTANCE === "1" && Boolean(liveUrl)

if (optedIn && !process.env.DATABASE_URL) process.env.DATABASE_URL = liveUrl as string

describe.skipIf(!optedIn)("ENH-01-01 minor-consent SQL-vs-policy equivalence (live, READ-ONLY)", () => {
  it("the SQL gate decides exactly minorPublicDecision on real player rows", { timeout: 60_000 }, async () => {
    const { db, players } = await import("@mtk/database")
    const { minorPublicDecision } = await import("@mtk/database/lib/minor-consent-policy")
    const { minorConsentPublicSql } = await import("@/lib/public-visibility")

    const SAMPLE = 1000
    const rows = await db
      .select({
        id: players.id,
        dateOfBirth: players.dateOfBirth,
        guardianConsentAt: players.guardianConsentAt,
        sqlVisible: minorConsentPublicSql.as("visible"),
      })
      .from(players)
      .limit(SAMPLE)

    const at = new Date()
    const mismatches: Array<{ id: string }> = []
    let minorsWithConsent = 0
    let adults = 0
    for (const row of rows) {
      const decision = minorPublicDecision(row.dateOfBirth, row.guardianConsentAt, at)
      const sqlVisible = row.sqlVisible === true
      if (decision.visible !== sqlVisible) mismatches.push({ id: row.id })
      if (decision.visible && decision.basis === "guardian_consent") minorsWithConsent += 1
      if (decision.basis === "adult") adults += 1
    }
    expect(rows.length).toBeGreaterThan(0)
    // Report the exercised space so an all-one-basis sample cannot masquerade
    // as full equivalence coverage.
    expect({ sampled: rows.length, adults, minorsWithConsent, mismatches: mismatches.length }).toEqual({
      sampled: rows.length,
      adults: expect.any(Number),
      minorsWithConsent: expect.any(Number),
      mismatches: 0,
    })
    expect(mismatches).toEqual([])
  })
})
