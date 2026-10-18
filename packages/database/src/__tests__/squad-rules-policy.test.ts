import { describe, expect, it } from "vitest"
import {
  canTransfer,
  describeSquadBlockers,
  isAccountLessPlayer,
  participationEligible,
  squadCompositionOk,
} from "../lib/squad-rules-policy"

describe("squad-rules policy (Batch 149, REG-06)", () => {
  it("an account-less player is league-recorded: no claimant, no self-service", () => {
    expect(isAccountLessPlayer({ userId: null })).toBe(true)
    expect(isAccountLessPlayer({ userId: "" })).toBe(true)
    expect(isAccountLessPlayer({ userId: "user-1" })).toBe(false)
  })

  it("a squad below the minimum is named as a size blocker", () => {
    const r = squadCompositionOk({ players: [{ id: "p1", userId: null, isMinor: false, guardianConsentAt: null }], minSize: 11, maxSize: 15 })
    expect(r.ok).toBe(false)
    expect(r.blockers).toContain("squad must have at least 11 players (currently 1)")
  })

  it("an oversized squad is named", () => {
    const players = Array.from({ length: 16 }, (_, i) => ({ id: `p${i}`, userId: null, isMinor: false, guardianConsentAt: null }))
    const r = squadCompositionOk({ players, minSize: 11, maxSize: 15 })
    expect(r.ok).toBe(false)
    expect(r.blockers).toContain("squad may not exceed 15 players (currently 16)")
  })

  it("a duplicate player is named", () => {
    const players = [
      { id: "p1", userId: null, isMinor: false, guardianConsentAt: null },
      { id: "p1", userId: null, isMinor: false, guardianConsentAt: null },
    ]
    const r = squadCompositionOk({ players, minSize: 2, maxSize: 15 })
    expect(r.blockers).toContain("duplicate player in squad")
  })

  it("a minor without guardian consent is named", () => {
    const r = squadCompositionOk({
      players: [{ id: "p1", userId: null, isMinor: true, guardianConsentAt: null }],
      minSize: 1, maxSize: 15,
    })
    expect(r.blockers).toContain("minor p1 has no recorded guardian consent")
  })

  it("a fully valid squad passes with no blockers", () => {
    const players = Array.from({ length: 11 }, (_, i) => ({ id: `p${i}`, userId: i === 0 ? "u1" : null, isMinor: false, guardianConsentAt: null }))
    expect(squadCompositionOk({ players, minSize: 11, maxSize: 15 })).toEqual({ ok: true, blockers: [] })
  })

  it("transfers are same-league only, and a minor's consent travels with the player", () => {
    expect(canTransfer({ sameLeague: false, playerInActiveMatch: false, minorWithoutConsent: false })).toEqual({
      ok: false, reason: "transfers are only allowed within the same league",
    })
    expect(canTransfer({ sameLeague: true, playerInActiveMatch: true, minorWithoutConsent: false })).toEqual({
      ok: false, reason: "player is currently in an active match - transfer after it concludes",
    })
    expect(canTransfer({ sameLeague: true, playerInActiveMatch: false, minorWithoutConsent: true })).toEqual({
      ok: false, reason: "minor player has no recorded guardian consent - cannot transfer",
    })
    expect(canTransfer({ sameLeague: true, playerInActiveMatch: false, minorWithoutConsent: false })).toEqual({ ok: true, reason: null })
  })

  it("participation requires squad membership AND an approved, paid-or-waived registration", () => {
    expect(participationEligible({ inSquad: true, registrationApproved: true, registrationPaidOrWaived: true })).toBe(true)
    expect(participationEligible({ inSquad: true, registrationApproved: true, registrationPaidOrWaived: false })).toBe(false)
    expect(participationEligible({ inSquad: false, registrationApproved: true, registrationPaidOrWaived: true })).toBe(false)
  })

  it("the member-facing sentence joins blockers verbatim", () => {
    expect(describeSquadBlockers([])).toBe("Squad is valid for this tournament.")
    expect(describeSquadBlockers(["a", "b"])).toBe("Squad invalid: a; b.")
  })
})
