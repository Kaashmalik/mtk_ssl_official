import { describe, expect, it } from "vitest"
import {
  MINOR_AGE_THRESHOLD, MINOR_CONSENT_LABELS,
  isMinorByRecord, minorPublicDecision, playerAgeYears,
} from "../lib/minor-consent-policy"

/**
 * Minor consent (PUB-06 + REG-06, Batch 132): pure decision fail-closed.
 * Semantics are pinned here because the web readers carry the SQL twin of
 * minorPublicDecision - these tests are the shared contract.
 */
const NOW = new Date("2026-10-18T12:00:00Z")

describe("minor-consent policy", () => {
  it("computes whole-year age over UTC and respects the birthday boundary", () => {
    expect(playerAgeYears("2008-10-18", NOW)).toBe(18) // turns 18 today: not minor
    expect(playerAgeYears("2008-10-19", NOW)).toBe(17) // still 17
    expect(playerAgeYears("2008-10-17", NOW)).toBe(18)
    expect(playerAgeYears(null, NOW)).toBeNull()
  })

  it("never guesses a minor from missing or unparseable data", () => {
    expect(isMinorByRecord(null, NOW)).toBe(false)
    expect(isMinorByRecord("", NOW)).toBe(false)
    expect(isMinorByRecord("not-a-date", NOW)).toBe(false)
    expect(minorPublicDecision(null, null, NOW)).toEqual({ visible: true, basis: "not_provable" })
    expect(minorPublicDecision("not-a-date", null, NOW)).toEqual({ visible: true, basis: "not_provable" })
  })

  it("is fail-closed: a proven minor is withheld without recorded consent", () => {
    expect(isMinorByRecord("2015-01-05", NOW)).toBe(true)
    expect(minorPublicDecision("2015-01-05", null, NOW))
      .toEqual({ visible: false, basis: "minor_without_consent" })
    // A future consent instant is not consent yet.
    expect(minorPublicDecision("2015-01-05", "2027-01-01T00:00:00Z", NOW))
      .toEqual({ visible: false, basis: "minor_without_consent" })
  })

  it("publishes a minor exactly while guardian consent is recorded; adults as before", () => {
    expect(minorPublicDecision("2015-01-05", "2026-10-01T00:00:00Z", NOW))
      .toEqual({ visible: true, basis: "guardian_consent" })
    expect(minorPublicDecision("1990-05-05", null, NOW)).toEqual({ visible: true, basis: "adult" })
  })

  it("keeps the threshold and the recorded-fact copy exactly", () => {
    expect(MINOR_AGE_THRESHOLD).toBe(18)
    expect(MINOR_CONSENT_LABELS.consentMissing).toContain("hidden from public records")
    expect(MINOR_CONSENT_LABELS.disclosure).toContain("league record, not a platform check")
  })
})
