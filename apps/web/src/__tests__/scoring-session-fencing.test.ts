import { describe, expect, it, vi } from "vitest"
import { scorerFencingDecision } from "@mtk/database/lib/scorer-fencing"
import { replayBallQueue } from "@/lib/replay-ball-queue"
import { HANDOVER_RESYNC_COPY, unwrapScoringFenceResult } from "@/lib/scoring-fence"
import { withScoringFence } from "@/lib/scoring-fence-action"
import type { QueuedBall } from "@/lib/offline-ball-queue"

// Deterministic multi-session model, not browser/device or database acceptance.
describe("Independent scorer sessions across a handover", () => {
  it("fences an old tab while a newly loaded tab can write", async () => {
    let matchEpoch = 2
    const write = withScoringFence(async (commandEpoch: number) => {
      const decision = scorerFencingDecision({ commandEpoch, matchEpoch })
      if (decision.status === "rejected") throw new Error(decision.reason)
      return { success: true }
    })
    const oldTabEpoch = matchEpoch
    expect(unwrapScoringFenceResult(await write(oldTabEpoch))).toEqual({ success: true })
    // Assignment changes away and back: the same identity's old tab is stale.
    matchEpoch += 2
    const newTabEpoch = matchEpoch
    const oldResult = JSON.parse(JSON.stringify(await write(oldTabEpoch)))
    expect(() => unwrapScoringFenceResult(oldResult)).toThrow(HANDOVER_RESYNC_COPY)
    expect(unwrapScoringFenceResult(await write(newTabEpoch))).toEqual({ success: true })
  })

  it.each([undefined, 0, 2])("retains queued work with its original epoch (%s) after handover", async (epoch) => {
    const queue: QueuedBall[] = ["old", "later"].map((clientOpId) => ({
      clientOpId, matchId: "match", inningsId: "innings", attempts: 0, queuedAt: 1,
      payload: { handoverEpoch: epoch, runs: 1 },
    }))
    const record = vi.fn(withScoringFence(async (payload: Record<string, unknown>) => {
      const decision = scorerFencingDecision({ commandEpoch: payload.handoverEpoch as number | undefined, matchEpoch: 4 })
      if (decision.status === "rejected") throw new Error(decision.reason)
      return { success: true, clientOpId: payload.clientOpId, ballId: "canonical" }
    }))
    const remove = vi.fn()
    const result = await replayBallQueue(queue, {
      record: async (payload) => unwrapScoringFenceResult(await record(payload)),
      remove, incrementAttempts: vi.fn(),
    })
    expect(result).toMatchObject({ synced: 0, blocked: "old" })
    expect(result.error).toHaveProperty("message", HANDOVER_RESYNC_COPY)
    expect(record).toHaveBeenCalledExactlyOnceWith({ handoverEpoch: epoch, runs: 1, clientOpId: "old" })
    expect(remove).not.toHaveBeenCalled()
    expect(queue[0].payload.handoverEpoch).toBe(epoch)
  })
})
