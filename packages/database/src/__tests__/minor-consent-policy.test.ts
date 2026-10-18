import { describe, expect, it } from "vitest"
import {
  MINOR_AGE_THRESHOLD, MINOR_CONSENT_LABELS, WITHHELD_NAME_LABEL,
  applyMinorNameGate, isMinorByRecord, minorPublicDecision, playerAgeYears,
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

describe("applyMinorNameGate (official-record name withholding, Batch 133)", () => {
  const NOW = new Date("2026-10-18T12:00:00Z")

  it("withholds a proven minor's name without consent; consent or adulthood shows it", () => {
    const byId = applyMinorNameGate(
      [
        { id: "minor-no", name: "Hidden Kid", dateOfBirth: "2015-01-05", guardianConsentAt: null },
        { id: "minor-ok", name: "Consented Kid", dateOfBirth: "2015-01-05", guardianConsentAt: new Date("2026-06-01T00:00:00Z") },
        { id: "adult", name: "Adult Player", dateOfBirth: "1990-05-05" },
        { id: "no-dob", name: "Unknown Age", dateOfBirth: null },
      ],
      NOW,
    )
    expect(byId.get("minor-no")).toBe(WITHHELD_NAME_LABEL)
    expect(byId.get("minor-ok")).toBe("Consented Kid")
    expect(byId.get("adult")).toBe("Adult Player")
    expect(byId.get("no-dob")).toBe("Unknown Age") // never guessed into a minor
  })

  it("keeps ids stable and tolerates missing names without inventing one", () => {
    const byId = applyMinorNameGate([{ id: "anon", name: null, dateOfBirth: "1990-01-01" }], NOW)
    expect(byId.get("anon")).toBe("")
    expect(applyMinorNameGate([], NOW).size).toBe(0)
  })
})
