import { describe, expect, it } from "vitest"
import { PUBLIC_FAN_REACTIONS, isScopedFanReaction } from "../lib/public-scoring-events"

describe("Public fan reactions have explicit match and league scope", () => {
  it.each(PUBLIC_FAN_REACTIONS)("accepts the approved reaction %s in the current context", emoji => {
    expect(isScopedFanReaction({ tenantId: "league", matchId: "match", emoji }, "league", "match")).toBe(true)
  })
  it.each([
    null, [], "🔥", {}, { tenantId: "other", matchId: "match", emoji: "🔥" },
    { tenantId: "league", matchId: "other", emoji: "🔥" },
    { tenantId: "league", matchId: "match", emoji: "<script>" },
    { matchId: "match", emoji: "🔥" },
  ].map(input => ({ input })))("rejects malformed, unscoped or foreign reaction $input", ({ input }) => {
    expect(isScopedFanReaction(input, "league", "match")).toBe(false)
  })
})
