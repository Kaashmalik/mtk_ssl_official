import { describe, expect, it, vi } from "vitest"
import { replayBallQueue } from "@/lib/replay-ball-queue"
import { isScoringAcknowledgement } from "../../../mobile/src/lib/scoring-ack"
import type { QueuedBall } from "@/lib/offline-ball-queue"

function queued(clientOpId: string, attempts = 0): QueuedBall {
  return { clientOpId, matchId: "match-1", inningsId: "innings-1", payload: { runs: 1 }, queuedAt: 1, attempts }
}

describe("Ordered offline replay without silent data loss", () => {
  it("retains repeatedly failing deliveries and stops before later deliveries", async () => {
    const record = vi.fn().mockRejectedValue(new Error("HTTP 400"))
    const remove = vi.fn()
    const incrementAttempts = vi.fn()
    const result = await replayBallQueue([queued("first", 20), queued("second")], { record, remove, incrementAttempts })
    expect(result).toMatchObject({ synced: 0, blocked: "first" })
    expect(record).toHaveBeenCalledOnce()
    expect(remove).not.toHaveBeenCalled()
    expect(incrementAttempts).toHaveBeenCalledWith("first")
  })

  it("removes only matching acknowledgements, including idempotent replay", async () => {
    const record = vi.fn(async (payload) => ({ success: true, ballId: "saved", clientOpId: payload.clientOpId, replayed: true }))
    const remove = vi.fn()
    const result = await replayBallQueue([queued("first"), queued("second")], { record, remove, incrementAttempts: vi.fn() })
    expect(result).toEqual({ synced: 2, blocked: null, error: null })
    expect(remove.mock.calls).toEqual([["first"], ["second"]])
  })

  it.each([undefined, {}, { success: false }, { success: true, ballId: "saved", clientOpId: "wrong" }])(
    "retains a delivery when the acknowledgement is missing or mismatched: %s", async (response) => {
      const remove = vi.fn()
      const result = await replayBallQueue([queued("first")], {
        record: vi.fn().mockResolvedValue(response), remove, incrementAttempts: vi.fn(),
      })
      expect(result.blocked).toBe("first")
      expect(remove).not.toHaveBeenCalled()
    },
  )

  it("keeps a successfully applied command queued when local deletion fails, allowing replay", async () => {
    const remove = vi.fn().mockRejectedValue(new Error("storage interrupted"))
    const result = await replayBallQueue([queued("first")], {
      record: vi.fn().mockResolvedValue({ success: true, ballId: "saved", clientOpId: "first" }),
      remove, incrementAttempts: vi.fn(),
    })
    expect(result).toMatchObject({ synced: 0, blocked: "first" })
  })

  it("mobile never acknowledges a generic 400, rejected status, or mismatched operation", () => {
    const body = { ballId: "saved", clientOpId: "first" }
    expect(isScoringAcknowledgement(400, body, "first")).toBe(false)
    expect(isScoringAcknowledgement(401, body, "first")).toBe(false)
    expect(isScoringAcknowledgement(201, body, "wrong")).toBe(false)
    expect(isScoringAcknowledgement(201, {}, "first")).toBe(false)
    expect(isScoringAcknowledgement(201, body, "first")).toBe(true)
  })
})
