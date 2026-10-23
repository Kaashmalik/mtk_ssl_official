import { describe, expect, it } from "vitest"
import {
  resolveWicketFielderId,
  resolveWicketVictimId,
  victimOptionsFromParticipants,
  wicketFielderQuestion,
  wicketFielderRequirement,
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

/**
 * Batch 103: fielder attribution (the Batch 102 ledger deferral). The command
 * schema, the offline queue adapter, the store types and the canonical
 * service (persist + bowling-XI validation) have carried
 * `wicketFielderId` since Batch 100 - but NEITHER client ever collected it,
 * so a caught dismissal was written without its catcher. The rule below is
 * ONE shared implementation for the web and mobile wicket flows.
 *
 * Cricket laws decide which dismissals name a fielder:
 * - `caught`   → REQUIRED (the catcher; the bowler may take it - caught and
 *                bowled - so the bowler id is a legitimate candidate).
 * - `run_out`  → OPTIONAL (the fielder who broke the wicket; multi-fielder
 *                relays are genuinely ambiguous, so skipping stays honest).
 * - `stumped`  → OPTIONAL (effectually always the wicketkeeper, but the
 *                surface does not observe a designated keeper, so the scorer
 *                may name or skip - the record never guesses one).
 * - `bowled`/`lbw`/`hit_wicket`/`retired`/`retired_hurt` → NONE: no fielder
 *   effects the dismissal and a collected id would be smuggled data.
 */
const CATCHER = "00000000-0000-4000-8000-0000000000f1"
const KEEPER = "00000000-0000-4000-8000-0000000000f2"
const BOWLER = "00000000-0000-4000-8000-0000000000f3"

describe("Batch 103: which dismissals ask for the fielder", () => {
  it("caught is required, run_out/stumped optional, everything else none", () => {
    expect(wicketFielderRequirement("caught")).toBe("required")
    expect(wicketFielderRequirement("run_out")).toBe("optional")
    expect(wicketFielderRequirement("stumped")).toBe("optional")
    for (const type of ["bowled", "lbw", "hit_wicket", "retired", "retired_hurt"]) {
      expect(wicketFielderRequirement(type)).toBe("none")
    }
    // Absent/junk types cannot become fielder questions (exact ids only).
    expect(wicketFielderRequirement(null)).toBe("none")
    expect(wicketFielderRequirement(undefined)).toBe("none")
    expect(wicketFielderRequirement("")).toBe("none")
    expect(wicketFielderRequirement("CAUGHT")).toBe("none")
    expect(wicketFielderRequirement("run out")).toBe("none")
  })

  it("the web and mobile flows read the same question text per type", () => {
    expect(wicketFielderQuestion("caught")).toContain("catch")
    expect(wicketFielderQuestion("run_out")).toContain("run")
    expect(wicketFielderQuestion("stumped")).toContain("keeper")
    expect(wicketFielderQuestion("bowled")).toBeNull()
    expect(wicketFielderQuestion("lbw")).toBeNull()
    expect(wicketFielderQuestion("hit_wicket")).toBeNull()
  })
})

describe("Batch 103: resolving the recorded fielder id", () => {
  const options = [CATCHER, KEEPER, BOWLER]

  it("records the chosen fielder for caught/run_out/stumped against the offered candidates", () => {
    expect(resolveWicketFielderId({ wicketType: "caught", options, chosenId: CATCHER })).toBe(CATCHER)
    expect(resolveWicketFielderId({ wicketType: "run_out", options, chosenId: CATCHER })).toBe(CATCHER)
    expect(resolveWicketFielderId({ wicketType: "stumped", options, chosenId: KEEPER })).toBe(KEEPER)
  })

  it("allows the bowler as the catcher (caught and bowled)", () => {
    expect(resolveWicketFielderId({ wicketType: "caught", options, chosenId: BOWLER })).toBe(BOWLER)
  })

  it("a skipped optional fielder records nothing - never a guess", () => {
    expect(resolveWicketFielderId({ wicketType: "run_out", options, chosenId: null })).toBeNull()
    expect(resolveWicketFielderId({ wicketType: "stumped", options, chosenId: undefined })).toBeNull()
  })

  it("a missing candidate set can never satisfy even a required catch (degrade, not invent)", () => {
    expect(resolveWicketFielderId({ wicketType: "caught", options: [], chosenId: CATCHER })).toBeNull()
    expect(resolveWicketFielderId({ wicketType: "caught", options, chosenId: null })).toBeNull()
  })

  it("refuses a fielder on fielder-less dismissals and a foreign/smuggled id", () => {
    expect(resolveWicketFielderId({ wicketType: "bowled", options, chosenId: CATCHER })).toBeNull()
    expect(resolveWicketFielderId({ wicketType: "lbw", options, chosenId: CATCHER })).toBeNull()
    expect(resolveWicketFielderId({ wicketType: "hit_wicket", options, chosenId: CATCHER })).toBeNull()
    expect(resolveWicketFielderId({ wicketType: "retired", options, chosenId: CATCHER })).toBeNull()
    expect(resolveWicketFielderId({ wicketType: "caught", options: [CATCHER, KEEPER], chosenId: THIRD_WHEEL })).toBeNull()
  })
})
