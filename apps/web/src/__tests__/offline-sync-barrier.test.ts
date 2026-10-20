import { beforeEach, describe, expect, it } from "vitest"

/**
 * ENH-01-04 (SCORE-14 conflict-head barrier): the offline queue is CAUSAL
 * order - ball 1 must not be delivered after ball 2 was reviewed-kept, and a
 * conflicted earlier delivery must fence every later delivery of the SAME
 * account until the conflict is resolved. The old semantics filtered
 * conflicted entries OUT of getPendingBalls(), so the next sync tick simply
 * walked past the unresolved head and flushed the rest.
 *
 * Mobile has no own test harness; the convention (see replay-ball-queue) is
 * to test mobile source from the web suite. The native storage engine is
 * stubbed via the vitest alias to __tests__/stubs/async-storage.ts.
 */

const ACCOUNT_A = "user_aaaa"
const ACCOUNT_B = "user_bbbb"

function ball(overrides: Partial<Record<string, unknown>> & { id: string }) {
  return {
    matchId: "match-1",
    innings: 1,
    over: 1,
    ball: 1,
    runs: 1,
    isWicket: false,
    timestamp: 0,
    synced: false,
    accountId: ACCOUNT_A,
    ...overrides,
  } as never
}

const { useOfflineStore } = await import("../../../mobile/src/store/offline-store")
const { syncFlushHead } = await import("../../../mobile/src/lib/sync-flush-head")

describe("offline sync conflict-head barrier (ENH-01-04)", () => {
  beforeEach(() => {
    useOfflineStore.setState({ pendingBalls: [], isOnline: true })
  })

  it("a conflicted head fences every later delivery of the same account", () => {
    useOfflineStore.setState({
      pendingBalls: [
        ball({ id: "head", conflicted: true, over: 1, ball: 1 }),
        ball({ id: "next", over: 1, ball: 2 }),
        ball({ id: "tail", over: 2, ball: 1 }),
      ],
    })
    // The conflicted ball MUST be the queue head until review resolves it;
    // nothing behind it may flush past it.
    expect(useOfflineStore.getState().getPendingBalls(undefined, ACCOUNT_A)).toEqual([])
    // It surfaces on the review side instead.
    expect(useOfflineStore.getState().getConflictedBalls(undefined, ACCOUNT_A).map((b: { id: string }) => b.id)).toEqual(["head"])
  })

  it("a conflict fences ONLY its own account: other accounts keep syncing", () => {
    useOfflineStore.setState({
      pendingBalls: [
        ball({ id: "head", conflicted: true, accountId: ACCOUNT_A }),
        ball({ id: "other", accountId: ACCOUNT_B }),
      ],
    })
    expect(useOfflineStore.getState().getPendingBalls(undefined, ACCOUNT_B).map((b: { id: string }) => b.id)).toEqual(["other"])
    expect(useOfflineStore.getState().getPendingBalls(undefined, ACCOUNT_A)).toEqual([])
  })

  it("an unconflicted queue flushes strictly in recorded order", () => {
    useOfflineStore.setState({
      pendingBalls: [
        ball({ id: "first", over: 1, ball: 1 }),
        ball({ id: "second", over: 1, ball: 2 }),
      ],
    })
    expect(useOfflineStore.getState().getPendingBalls(undefined, ACCOUNT_A).map((b: { id: string }) => b.id)).toEqual(["first", "second"])
  })

  it("syncFlushHead stops at the first conflicted entry, keeping the prefix", () => {
    const queue = [
      { id: "a", conflicted: false },
      { id: "b", conflicted: false },
      { id: "c", conflicted: true },
      { id: "d", conflicted: false },
    ]
    expect(syncFlushHead(queue).map((b: { id: string }) => b.id)).toEqual(["a", "b"])
    expect(syncFlushHead([{ id: "solo", conflicted: true }])).toEqual([])
    expect(syncFlushHead([])).toEqual([])
  })
})
