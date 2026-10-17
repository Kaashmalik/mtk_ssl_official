import { describe, expect, it } from "vitest"
import {
  careerConsentGranted,
  careerProfilePublishable,
  isVerifiedPlayerRecord,
  mergeConsentedCareer,
} from "../lib/career-records"

describe("Public career profile gate (PUB-02)", () => {
  const consented = { isActive: true, publicCareerConsentAt: new Date("2026-10-17T00:00:00Z") }
  it("publishes only an active, consenting account to the anonymous surface", () => {
    expect(careerProfilePublishable(consented)).toBe(true)
  })

  it("fails closed on inactive, unconsenting, missing or undefined accounts", () => {
    expect(careerProfilePublishable({ ...consented, isActive: false })).toBe(false)
    expect(careerProfilePublishable({ ...consented, publicCareerConsentAt: null })).toBe(false)
    expect(careerProfilePublishable(null)).toBe(false)
    expect(careerProfilePublishable(undefined)).toBe(false)
  })
})

describe("Verified player records (PUB-03)", () => {
  it("verifies only a roster entry linked to an ACTIVE account", () => {
    expect(isVerifiedPlayerRecord({ userId: "u1" }, { isActive: true })).toBe(true)
    expect(isVerifiedPlayerRecord({ userId: "u1" }, { isActive: false })).toBe(false)
  })

  it("never verifies name-only roster rows or missing accounts", () => {
    expect(isVerifiedPlayerRecord({ userId: null }, { isActive: true })).toBe(false)
    expect(isVerifiedPlayerRecord({ userId: "u1" }, null)).toBe(false)
    expect(isVerifiedPlayerRecord({ userId: "u1" }, undefined)).toBe(false)
  })
})

describe("Consented career linkage (PUB-03)", () => {
  it("grants only on an affirmative, non-revoked consent timestamp", () => {
    expect(careerConsentGranted({ publicCareerConsentAt: new Date("2026-10-16T00:00:00Z") })).toBe(true)
    expect(careerConsentGranted({ publicCareerConsentAt: null })).toBe(false)
    expect(careerConsentGranted(null)).toBe(false)
    expect(careerConsentGranted(undefined)).toBe(false)
  })

  it("fails closed: no consent means no cross-league career, ever", () => {
    const leagues = [
      { tenantId: "t1", runsScored: 120, wicketsTaken: 3 },
      { tenantId: "t2", runsScored: 80, wicketsTaken: 11 },
    ]
    expect(mergeConsentedCareer(leagues, false)).toBeNull()
    expect(mergeConsentedCareer(leagues, true)).toEqual({
      leagues,
      totalRunsScored: 200,
      totalWicketsTaken: 14,
    })
  })

  it("folds totals while keeping per-league provenance", () => {
    const merged = mergeConsentedCareer([
      { tenantId: "t1", runsScored: 0, wicketsTaken: 0 },
      { tenantId: "t2", runsScored: 5, wicketsTaken: 0 },
    ], true)
    expect(merged).not.toBeNull()
    expect(merged!.leagues.map((l) => l.tenantId)).toEqual(["t1", "t2"])
    expect(merged!.totalRunsScored).toBe(5)
  })

  it("refuses to double-count one league supplied twice (caller bug, not a sum)", () => {
    expect(() => mergeConsentedCareer([
      { tenantId: "t1", runsScored: 10, wicketsTaken: 0 },
      { tenantId: "t1", runsScored: 20, wicketsTaken: 0 },
    ], true)).toThrow(/Duplicate league totals/)
  })

  it("an empty consented career folds to zeros, not null", () => {
    expect(mergeConsentedCareer([], true)).toEqual({
      leagues: [],
      totalRunsScored: 0,
      totalWicketsTaken: 0,
    })
  })
})
