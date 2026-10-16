import { describe, expect, it } from "vitest"
import { voiceDeliveryFlags } from "@/lib/scoring-voice-input"

describe("Voice delivery normalization", () => {
  it.each([0, 1, 2, 3, 4, 6] as const)("retains %s batter runs without inventing an extra or wicket", input => {
    expect(voiceDeliveryFlags(input)).toEqual({ input, runs: input, isWicket: false, isWide: false, isNoBall: false, isBye: false, isLegBye: false })
  })
  it.each([
    ["WD", "isWide"], ["NB", "isNoBall"], ["B", "isBye"], ["LB", "isLegBye"],
  ] as const)("maps %s to exactly one extra flag", (input, flag) => {
    const result = voiceDeliveryFlags(input)
    expect(result).toMatchObject({ input, runs: 1, isWicket: false, [flag]: true })
    expect([result?.isWide, result?.isNoBall, result?.isBye, result?.isLegBye].filter(Boolean)).toHaveLength(1)
  })
  it("refuses a bare voice wicket so the operator must select a dismissal type", () => {
    expect(voiceDeliveryFlags("W")).toBeNull()
  })
})
