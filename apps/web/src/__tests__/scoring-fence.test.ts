import { describe, expect, it } from "vitest"
import { HANDOVER_RESYNC_COPY, isHandoverFencingError, scoringHandoverEpoch, unwrapScoringFenceResult } from "../lib/scoring-fence"
import { withScoringFence } from "../lib/scoring-fence-action"

describe("scoring fence UI mirror (SCORE-11)", () => {
  it("serializes only expected failures and reconstructs the prompt on the client", async () => {
    const action = withScoringFence(async () => { throw new Error(`Scoring service error (403): ${HANDOVER_RESYNC_COPY}`) })
    const wireResult = JSON.parse(JSON.stringify(await action()))
    expect(wireResult).toEqual({ success: false, code: "SCORING_SESSION_FENCED", message: HANDOVER_RESYNC_COPY })
    expect(() => unwrapScoringFenceResult(wireResult)).toThrow(HANDOVER_RESYNC_COPY)
    const accepted = { success: true, ballId: "confirmed" }
    expect(unwrapScoringFenceResult(accepted)).toBe(accepted)
  })

  it("does not turn unexpected internal failures into public action results", async () => {
    const action = withScoringFence(async () => { throw new Error("Private database failure") })
    await expect(action()).rejects.toThrow("Private database failure")
  })
  it("recognizes the canonical handover rejections, proxy-wrapped or bare", () => {
    expect(isHandoverFencingError(new Error(
      `Scoring service error (403): ${HANDOVER_RESYNC_COPY}`))).toBe(true)
    expect(isHandoverFencingError(new Error(
      "Invalid scoring session token. Reload the scoring session."))).toBe(true)
    expect(isHandoverFencingError(HANDOVER_RESYNC_COPY)).toBe(true)
    expect(isHandoverFencingError(new Error("Scoring service error (503): Database unavailable"))).toBe(false)
    expect(isHandoverFencingError(new Error("Undo was not confirmed"))).toBe(false)
    expect(isHandoverFencingError({ message: HANDOVER_RESYNC_COPY })).toBe(false)
    expect(isHandoverFencingError(null)).toBe(false)
    expect(isHandoverFencingError(undefined)).toBe(false)
  })

  it("mirrors the epoch with the same absent-reads-as-legacy semantics as the policy", () => {
    expect(scoringHandoverEpoch({ handoverEpoch: 5 })).toBe(5)
    expect(scoringHandoverEpoch({ handoverEpoch: 0 })).toBe(0)
    expect(scoringHandoverEpoch({ handoverEpoch: null })).toBeUndefined()
    expect(scoringHandoverEpoch({})).toBeUndefined()
    expect(scoringHandoverEpoch(null)).toBeUndefined()
    expect(scoringHandoverEpoch(undefined)).toBeUndefined()
  })
})
