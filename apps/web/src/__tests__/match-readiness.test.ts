import { describe, expect, it } from "vitest"
import { computeMatchReadiness } from "@/lib/match-readiness"

const T = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`

const readyFixture = {
  status: "scheduled",
  scheduledDate: new Date("2026-11-01T15:00:00.000Z"),
  venueId: T(90),
  tossWinnerId: null,
  tossDecision: null,
  scorerId: T(70),
  backupScorerId: null,
  umpire1: "Ravi S.",
  tournamentId: null,
}

const check = (input: Parameters<typeof computeMatchReadiness>[0], id: string) =>
  computeMatchReadiness(input).checks.find(c => c.id === id)!

describe("match readiness (COMP-06, v2)", () => {
  it("a fully prepared scheduled match is ready", () => {
    const result = computeMatchReadiness(readyFixture)
    expect(result.ready).toBe(true)
    expect(result.checks.map(c => c.id)).toEqual(["schedule", "venue", "scorer", "toss", "officials"])
    // Non-tournament fixtures never carry the squads check.
    expect(result.checks.some(c => c.id === "squads")).toBe(false)
  })

  it("date and venue are blocking; a missing scorer is only recommended", () => {
    const noScorer = computeMatchReadiness({ ...readyFixture, scorerId: null, backupScorerId: null })
    expect(noScorer.ready).toBe(true)
    expect(check({ ...readyFixture, scorerId: null, backupScorerId: null }, "scorer").pass).toBe(false)
    expect(check({ ...readyFixture, scorerId: null, backupScorerId: null }, "scorer").blocking).toBe(false)

    const noVenueInput = { ...readyFixture, venueId: null }
    expect(computeMatchReadiness(noVenueInput).ready).toBe(false)
    expect(check(noVenueInput, "venue").blocking).toBe(true)

    const noDateInput = { ...readyFixture, scheduledDate: null }
    expect(computeMatchReadiness(noDateInput).ready).toBe(false)
  })

  it("a backup scorer satisfies the scorer recommendation", () => {
    const input = { ...readyFixture, scorerId: null, backupScorerId: T(71) }
    const result = computeMatchReadiness(input)
    expect(check(input, "scorer").pass).toBe(true)
    expect(result.ready).toBe(true)
  })

  it("the toss blocks once the match has moved past scheduled, not before", () => {
    expect(computeMatchReadiness(readyFixture).ready).toBe(true)

    const warmingUpInput = { ...readyFixture, status: "toss" }
    const tossMissing = computeMatchReadiness(warmingUpInput)
    expect(tossMissing.ready).toBe(false)
    expect(check(warmingUpInput, "toss").blocking).toBe(true)

    const tossDoneInput = { ...warmingUpInput, tossWinnerId: T(1), tossDecision: "bat" }
    expect(computeMatchReadiness(tossDoneInput).ready).toBe(true)
  })

  it("tournament fixtures get a squads check: half-declared registrations fail it without blocking", () => {
    const legacyInput = { ...readyFixture, tournamentId: T(2) }
    const legacy = computeMatchReadiness(legacyInput) // no registration facts at all
    expect(legacy.ready).toBe(true)
    expect(check(legacyInput, "squads").pass).toBe(true)

    const halfDeclaredInput = { ...legacyInput, teamASquadDeclared: true, teamBSquadDeclared: false }
    const halfDeclared = computeMatchReadiness(halfDeclaredInput)
    expect(check(halfDeclaredInput, "squads").pass).toBe(false)
    expect(halfDeclared.ready).toBe(true) // advisory in v1
    expect(check(halfDeclaredInput, "squads").blocking).toBe(false)

    const bothDeclaredInput = { ...legacyInput, teamASquadDeclared: true, teamBSquadDeclared: true }
    expect(computeMatchReadiness(bothDeclaredInput).ready).toBe(true)
  })

  it("an empty umpire string fails the advisory officials check without blocking", () => {
    const input = { ...readyFixture, umpire1: "" }
    const result = computeMatchReadiness(input)
    expect(check(input, "officials").pass).toBe(false)
    expect(result.ready).toBe(true)
  })

  it("the advisory officials check accepts either free text or a member-bound umpire", () => {
    // Free text alone (legacy) still passes; empty text with no member fails.
    expect(check({ ...readyFixture }, "officials").pass).toBe(true)
    expect(check({ ...readyFixture, umpire1: "" }, "officials").pass).toBe(false)
    expect(check({ ...readyFixture, umpire1: "" }, "officials").label).toBe("Umpire listed or assigned")
    // A member-bound assignment satisfies it with no free text at all.
    expect(check({ ...readyFixture, umpire1: "", umpire1Id: T(90) as unknown as string }, "officials").pass).toBe(true)
    const secondOnly = { ...readyFixture, umpire1: "", umpire2Id: T(91) as unknown as string }
    expect(check(secondOnly, "officials").pass).toBe(true)
    // Both forms coexist; assigning a member never rewrites a listing.
    expect(check({ ...readyFixture, umpire1Id: T(90) as unknown as string }, "officials").pass).toBe(true)
  })
  it.each(["teamARegistrationApproved", "teamBRegistrationApproved"] as const)("blocks a known non-approved registration on %s", field => {
    const input = { ...readyFixture, tournamentId: T(2), [field]: false }
    expect(computeMatchReadiness(input).ready).toBe(false)
    expect(check(input, "registration")).toMatchObject({ pass: false, blocking: true })
  })
  it("preserves approved and missing-registration legacy readiness", () => {
    const input = { ...readyFixture, tournamentId: T(2), teamARegistrationApproved: true }
    expect(check(input, "registration")).toMatchObject({ pass: true, blocking: true })
    expect(computeMatchReadiness(input).ready).toBe(true)
  })
})
describe("match readiness - official approval (COMP-06 consent)", () => {
  it("consent is part of the scorer check only when the requirement is armed", () => {
    // Legacy matches (requirement absent) keep passing on assignment alone.
    expect(check({ ...readyFixture }, "scorer").pass).toBe(true)
    expect(check({ ...readyFixture }, "scorer").label).toBe("Scorer assigned")
    // Pending consent fails, no matter which slot is occupied.
    const pending = { ...readyFixture, scorerApprovalRequired: true }
    expect(check(pending, "scorer").pass).toBe(false)
    expect(check(pending, "scorer").label).toBe("Scorer assigned and approved")
    expect(check({ ...pending, scorerId: null, backupScorerId: T(80) as unknown as string }, "scorer").pass).toBe(false)
    expect(check({ ...pending, scorerApprovalRequired: false }, "scorer").pass).toBe(true)
  })
  it("recorded consent satisfies the check for primary and backup alike", () => {
    const withConsent = { ...readyFixture, scorerApprovalRequired: true, scorerApprovedAt: new Date("2026-10-16T10:00:00Z") }
    expect(check(withConsent, "scorer").pass).toBe(true)
    const backup = { ...withConsent, scorerId: null, backupScorerId: T(80) as unknown as string }
    expect(check(backup, "scorer").pass).toBe(true)
    expect(check(withConsent, "scorer").blocking).toBe(false)
  })
  it("members-umpire consent is part of the officials check only when the requirement is armed", () => {
    // Legacy / free-text-only matches and unconsented-free member team keep the old shape.
    expect(check({ ...readyFixture }, "officials").pass).toBe(true)
    expect(check({ ...readyFixture }, "officials").label).toBe("Umpire listed or assigned")
    expect(check({ ...readyFixture, umpire1: "", umpire1Id: T(90) as unknown as string }, "officials").pass).toBe(true)
    // Pending member-umpire consent fails the advisory - even with a free-text listing alongside.
    const pending = { ...readyFixture, umpire1: "Ext.", umpire1Id: T(90) as unknown as string, umpireApprovalRequired: true }
    expect(check(pending, "officials").pass).toBe(false)
    expect(check(pending, "officials").label).toBe("Member umpire assigned and approved")
    expect(check({ ...pending, umpire1: "" }, "officials").pass).toBe(false)
    // Recorded consent satisfies it, including a second-slot occupation.
    const withConsent = { ...pending, umpireApprovedAt: new Date("2026-10-16T11:00:00Z") }
    expect(check(withConsent, "officials").pass).toBe(true)
    expect(check({ ...withConsent, umpire1Id: null, umpire2Id: T(91) as unknown as string }, "officials").pass).toBe(true)
    expect(check(withConsent, "officials").blocking).toBe(false)
  })
})
describe("match readiness - declared playing XIs (COMP-06 slice)", () => {
  const tournament = { ...readyFixture, tournamentId: T(2) }
  it("an armed match blocks on official approval until both XIs are approved", () => {
    const pending = { ...tournament, xiRequired: true }
    expect(check(pending, "playing-xi")).toMatchObject({ label: "Playing XIs declared and approved", pass: false, blocking: true })
    expect(computeMatchReadiness(pending).ready).toBe(false)

    const approved = { ...pending, xiApprovedAt: new Date("2026-10-17T09:00:00Z") }
    expect(check(approved, "playing-xi").pass).toBe(true)
    expect(computeMatchReadiness(approved).ready).toBe(true)
  })
  it("a legacy tournament match keeps XI as a non-blocking recommendation", () => {
    expect(check({ ...tournament }, "playing-xi")).toMatchObject({ label: "Playing XIs declared (recommended)", pass: false, blocking: false })
    expect(computeMatchReadiness(tournament).ready).toBe(true)
    expect(check({ ...tournament, xiRequired: false }, "playing-xi").blocking).toBe(false)
  })
})
