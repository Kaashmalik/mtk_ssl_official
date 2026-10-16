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
