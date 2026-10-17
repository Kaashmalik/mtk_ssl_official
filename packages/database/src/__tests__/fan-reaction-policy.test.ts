import { describe, expect, it } from "vitest"
import {
  FAN_REACTION_TYPES, isFanReactionType, reactionRateDecision,
  reactionTargetDecision, FAN_REACTION_MAX_PER_WINDOW, FAN_REACTION_LABELS,
} from "../lib/fan-reaction-policy"

describe("Fan reaction policy (FAN-01)", () => {
  it("exposes a fixed, labelled, non-official reaction set with no free text", () => {
    expect(FAN_REACTION_TYPES).toEqual(["four", "six", "wicket", "clap", "fire"])
    for (const type of FAN_REACTION_TYPES) {
      expect(typeof FAN_REACTION_LABELS[type]).toBe("string")
      expect(FAN_REACTION_LABELS[type].length).toBeGreaterThan(0)
    }
    expect(isFanReactionType("four")).toBe(true)
    expect(isFanReactionType("FIRE")).toBe(false) // case-pinned: no surprises at the DB CHECK.
    expect(isFanReactionType("offensive-thing")).toBe(false)
    expect(isFanReactionType(42)).toBe(false)
  })

  it("rate-limits flood adds at the shared floor and never limits removals (removals are not abuse)", () => {
    expect(reactionRateDecision(0)).toEqual({ allowed: true, reason: "ok" })
    expect(reactionRateDecision(FAN_REACTION_MAX_PER_WINDOW - 1)).toEqual({ allowed: true, reason: "ok" })
    expect(reactionRateDecision(FAN_REACTION_MAX_PER_WINDOW)).toEqual({ allowed: false, reason: "rate_limited" })
    expect(reactionRateDecision(9999)).toEqual({ allowed: false, reason: "rate_limited" })
  })

  it("admits published, played or playable matches", () => {
    for (const matchStatus of ["scheduled", "toss", "live", "innings_break", "completed", "abandoned", "no_result"]) {
      const decision = reactionTargetDecision({ matchStatus, tournamentStatus: "live" })
      expect(decision).toEqual({ allowed: true, reason: "ok" })
    }
  })

  it("refuses unpublished targets - including cancelled fixtures, per the house publication gate", () => {
    expect(reactionTargetDecision({ matchStatus: "live", tournamentStatus: "draft" }))
      .toEqual({ allowed: false, reason: "target_unpublished" })
    expect(reactionTargetDecision({ matchStatus: "draft", tournamentStatus: "live" }))
      .toEqual({ allowed: false, reason: "target_unpublished" })
    // Cancelled is outside the published match statuses, so it refuses too.
    expect(reactionTargetDecision({ matchStatus: "cancelled", tournamentStatus: "completed" }))
      .toEqual({ allowed: false, reason: "target_unpublished" })
  })
})
