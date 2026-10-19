import "fake-indexeddb/auto"
import { IDBFactory } from "fake-indexeddb"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { queueBall, getQueuedBalls, removeQueuedBall, incrementAttempts, countQueuedBalls, type QueuedBall } from "@/lib/offline-ball-queue"
import { scoringQueueKey } from "@/lib/scoring-queue-scope"

/**
 * SCORE-09 (web half) storage isolation. fake-indexeddb runs the REAL idb
 * code path: scoping keys, payload immutability and cross-scope invisibility
 * are exercised against the actual store, not a mock. The canonical server
 * gate is separately tested in the action suites — this storage seam alone
 * is not write authority.
 */

const MATCH = "00000000-0000-4000-8000-000000000001"
const LEAGUE = "00000000-0000-4000-8000-00000000aa01"
const ALI = { accountId: "account-ali", tenantId: LEAGUE, matchId: MATCH }
const SANA = { accountId: "account-sana", tenantId: LEAGUE, matchId: MATCH }

function base(overrides: Partial<QueuedBall> = {}): Omit<QueuedBall, "queuedAt" | "attempts"> {
  return {
    clientOpId: "op-1", matchId: MATCH,
    inningsId: "00000000-0000-4000-8000-00000000b001",
    payload: { matchId: MATCH, inningsId: "00000000-0000-4000-8000-00000000b001", overNumber: 0, ballNumber: 1, runs: 1 },
    ...overrides,
  }
}

beforeEach(() => { globalThis.indexedDB = new IDBFactory() })
afterEach(() => { void new IDBFactory() })

describe("scoped offline ball queue (SCORE-09)", () => {
  it("rejects a delivery whose saved payload contradicts the verified workspace", async () => {
    await expect(queueBall(base({ payload: { matchId: "other" } }), ALI)).rejects.toThrow(/workspace/)
    await expect(queueBall(base({ matchId: "other" }), ALI)).rejects.toThrow(/workspace/)
    await expect(queueBall(base({ payload: { matchId: "other" } }), ALI)).rejects.toThrow()
    await expect(countQueuedBalls(MATCH, ALI)).resolves.toBe(0)
  })

  it("hides another signed-in account's saved work completely", async () => {
    await queueBall(base(), ALI)
    await expect(getQueuedBalls(MATCH, SANA)).resolves.toEqual([])
    await expect(countQueuedBalls(MATCH, SANA)).resolves.toBe(0)
    await expect(getQueuedBalls(MATCH, ALI)).resolves.toHaveLength(1)
  })

  it("never mutates a saved command's content on requeue; identical replay is a no-op", async () => {
    await queueBall(base(), ALI)
    await expect(queueBall({ ...base(), payload: { ...base().payload, runs: 6 } }, ALI))
      .rejects.toThrow(/Saved operation changed/)
    await queueBall(base(), ALI) // identical bytes again
    const rows = await getQueuedBalls(MATCH, ALI)
    expect(rows).toHaveLength(1)
    expect(rows[0].payload.runs).toBe(1)
    expect(rows[0].attempts).toBe(0)
  })

  it("limits attempts/removal to the owning scope", async () => {
    await queueBall(base(), ALI)
    await incrementAttempts("op-1", SANA)
    await expect(getQueuedBalls(MATCH, ALI)).resolves.toEqual([expect.objectContaining({ attempts: 0 })])
    await incrementAttempts("op-1", ALI)
    await removeQueuedBall("op-1", SANA)
    await expect(getQueuedBalls(MATCH, ALI)).resolves.toEqual([expect.objectContaining({ attempts: 1 })])
    await removeQueuedBall("op-1", ALI)
    await expect(countQueuedBalls(MATCH, ALI)).resolves.toBe(0)
  })

  it("refuses to operate without a verified scope and orders by queue time", async () => {
    expect(() => scoringQueueKey({ accountId: "", tenantId: LEAGUE, matchId: MATCH })).toThrow(/Verified scoring account/)
    await expect(getQueuedBalls(MATCH, { accountId: "a", tenantId: LEAGUE, matchId: "other-match" })).resolves.toEqual([])
    await queueBall(base({ clientOpId: "op-2" }), ALI)
    await queueBall(base({ clientOpId: "op-1" }), ALI)
    const order = (await getQueuedBalls(MATCH, ALI)).map(row => row.clientOpId)
    expect(order).toEqual(["op-1", "op-2"])
  })
})
