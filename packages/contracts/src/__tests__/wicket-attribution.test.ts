import { describe, expect, it } from "vitest"
import {
  resolveWicketVictimId,
  victimOptionsFromParticipants,
  wicketRequiresVictimAttribution,
  type WicketVictimOption,
} from "../wicket-attribution"
import type { ScoringParticipants } from "../scoring"

/**
 * Batch 102: shared run-out victim-attribution policy. One implementation
 * for the web picker and the mobile picker; the server fold stays the only
 * participant-derivation authority. The device never invents an unobserved
 * canonical claim and never smuggles an un-offered id into the record.
 */

const STRIKER = "00000000-0000-4000-8000-0000000000b1"
const NON_STRIKER = "00000000-0000-4000-8000-0000000000b2"
const THIRD_WHEEL = "00000000-0000-4000-8000-0000000000b3"

function participants(overrides: Partial<ScoringParticipants> = {}): ScoringParticipants {
  return {
    strikerId: STRIKER,
    nonStrikerId: NON_STRIKER,
    bowlerId: null,
    previousOverBowlerId: null,
    incomingBatterId: null,
    creaseBatterIds: [STRIKER, NON_STRIKER],
    confirmed: true,
    lastBallSequence: 12,
    ...overrides,
  }
}

describe("Batch 102: which dismissals require naming the victim", () => {
  it("asks ONLY for run_out - every other type is striker-fixed by rule", () => {
    for (const type of ["bowled", "caught", "lbw", "stumped", "hit_wicket"]) {
      expect(wicketRequiresVictimAttribution(type)).toBe(false)
    }
    expect(wicketRequiresVictimAttribution("run_out")).toBe(true)
    // Absent/junk types cannot become victim questions.
    expect(wicketRequiresVictimAttribution(null)).toBe(false)
    expect(wicketRequiresVictimAttribution(undefined)).toBe(false)
    expect(wicketRequiresVictimAttribution("")).toBe(false)
    expect(wicketRequiresVictimAttribution("RUN_OUT")).toBe(false) // exact contract ids only
  })
})

describe("Batch 102: victim candidates from the service-confirmed crease", () => {
  it("offers both confirmed occupants, striker first and strike-marked", () => {
    expect(victimOptionsFromParticipants(participants())).toEqual([
      { id: STRIKER, onStrike: true },
      { id: NON_STRIKER, onStrike: false },
    ])
  })

  it("refuses to guess from an unconfirmed projection or missing striker", () => {
    expect(victimOptionsFromParticipants(participants({ confirmed: false }))).toEqual([])
    expect(victimOptionsFromParticipants(participants({ strikerId: null, nonStrikerId: NON_STRIKER }))).toEqual([])
    expect(victimOptionsFromParticipants(null)).toEqual([])
    expect(victimOptionsFromParticipants(undefined)).toEqual([])
  })

  it("degrades to the striker alone when no non-striker is confirmed", () => {
    expect(victimOptionsFromParticipants(participants({ nonStrikerId: null }))).toEqual([
      { id: STRIKER, onStrike: true },
    ])
    // A degenerate same-id projection collapses to one candidate.
    expect(victimOptionsFromParticipants(participants({ nonStrikerId: STRIKER }))).toEqual([
      { id: STRIKER, onStrike: true },
    ])
  })
})

describe("Batch 102: resolving the recorded victim id", () => {
  const options: WicketVictimOption[] = [
    { id: STRIKER, onStrike: true },
    { id: NON_STRIKER, onStrike: false },
  ]

  it("records the chosen victim only for run_out against the offered candidates", () => {
    // The off-strike run-out - the case Batch 100 fixed for the web.
    expect(resolveWicketVictimId({ wicketType: "run_out", options, chosenId: NON_STRIKER })).toBe(NON_STRIKER)
    expect(resolveWicketVictimId({ wicketType: "run_out", options, chosenId: STRIKER })).toBe(STRIKER)
  })

  it("writes NO attribution for striker-fixed types even if an id arrives", () => {
    expect(resolveWicketVictimId({ wicketType: "bowled", options, chosenId: STRIKER })).toBeNull()
    expect(resolveWicketVictimId({ wicketType: "caught", options, chosenId: NON_STRIKER })).toBeNull()
  })
})

describe("Batch 102: never smuggling an un-offered id", () => {
  const options: WicketVictimOption[] = [
    { id: STRIKER, onStrike: true },
    { id: NON_STRIKER, onStrike: false },
  ]

  it("returns null when the crease was not confirmed or the choice is foreign", () => {
    expect(resolveWicketVictimId({ wicketType: "run_out", options: [], chosenId: STRIKER })).toBeNull()
    expect(resolveWicketVictimId({ wicketType: "run_out", options: [{ id: STRIKER, onStrike: true }], chosenId: STRIKER })).toBeNull()
    expect(resolveWicketVictimId({ wicketType: "run_out", options, chosenId: THIRD_WHEEL })).toBeNull()
    expect(resolveWicketVictimId({ wicketType: "run_out", options, chosenId: null })).toBeNull()
    expect(resolveWicketVictimId({ wicketType: "run_out", options, chosenId: undefined })).toBeNull()
  })
})
