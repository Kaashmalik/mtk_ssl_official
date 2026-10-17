import { describe, expect, it } from "vitest"
import { reviewedDelivery, pendingDeliveryRevision } from "@/lib/scoring-recovery"
import { ScoringRevisionConflict } from "@/lib/scoring-revision-client"
import { withScoringFence } from "@/lib/scoring-fence-action"
import { scoringWriteConflictMessage, unwrapScoringFenceResult } from "@/lib/scoring-fence"
import type { ScoringPageSnapshot } from "@/lib/scoring-hydration"
import type { QueuedBall } from "@/lib/offline-ball-queue"
import type { ScoringState } from "@/stores/scoring-store"

function queued(): QueuedBall {
  return { clientOpId: "original-op", matchId: "match", inningsId: "innings", attempts: 2, queuedAt: 1,
    payload: { matchId: "match", inningsId: "innings", clientOpId: "original-op", handoverEpoch: 1, expectedRevision: 5,
      overNumber: 2, ballNumber: 3, runs: 4, batsmanId: "batter", bowlerId: "bowler", isWide: false } }
}
function snapshot(): ScoringPageSnapshot {
  return { canScore: true, match: { id: "match", handoverEpoch: 3, scoringRevision: 9 },
    innings: [{ id: "innings" }] } as unknown as ScoringPageSnapshot
}

describe("Explicit saved-delivery review", () => {
  it("preserves original identity and delivery contents without mutating the queue", () => {
    const item = queued()
    const before = structuredClone(item)
    const command = reviewedDelivery(item, snapshot(), "  Checked against official score  ")
    expect(command).toMatchObject({ clientOpId: item.clientOpId, overNumber: 2, ballNumber: 3, runs: 4,
      batsmanId: "batter", bowlerId: "bowler", handoverEpoch: 3, expectedRevision: 9,
      review: { reason: "Checked against official score", previousEpoch: 1, previousRevision: 5 } })
    expect(item).toEqual(before)
  })
  it.each(["unauthorized", "foreign match", "foreign payload", "foreign innings", "missing innings"])(
    "rejects %s review without changing the original operation", scenario => {
      const item = queued()
      const current = snapshot()
      if (scenario === "unauthorized") current.canScore = false
      if (scenario === "foreign match") current.match.id = "other"
      if (scenario === "foreign payload") item.payload.matchId = "other"
      if (scenario === "foreign innings") item.payload.inningsId = "other"
      if (scenario === "missing innings") current.innings = []
      expect(() => reviewedDelivery(item, current, "Reviewed by current scorer")).toThrow("cannot be reviewed")
    })
  it.each(["", "short", "x".repeat(1001)])("requires a bounded meaningful reason", reason => {
    expect(() => reviewedDelivery(queued(), snapshot(), reason)).toThrow("10 to 1000")
  })
  it("predicts ordered offline revisions without replacing the stored tokens", () => {
    const state = { scoringRevision: 8, innings1: { balls: [{ id: "ball-1" }, { id: "ball-2" }] },
      innings2: null, superOver: null } as unknown as ScoringState
    expect(pendingDeliveryRevision(state)).toBe(9)
    state.scoringRevision = 9
    state.innings1!.balls[0].id = "canonical-1"
    expect(pendingDeliveryRevision(state)).toBe(9)
  })
  it("serializes revision conflicts and reconstructs a terminal client error", async () => {
    const action = withScoringFence(async () => { throw new ScoringRevisionConflict(9) })
    const result = JSON.parse(JSON.stringify(await action()))
    expect(result).toMatchObject({ success: false, code: "SCORING_REVISION_CONFLICT", currentRevision: 9 })
    try { unwrapScoringFenceResult(result); throw new Error("Must not acknowledge conflict") }
    catch (error) {
      expect(error).toBeInstanceOf(ScoringRevisionConflict)
      expect(scoringWriteConflictMessage(error)).toContain("official score changed")
    }
  })
})
