import { beforeEach, describe, expect, it, vi } from "vitest"
import { reconcileLiveState } from "@/lib/reconcile-live-state"
import { useScoringStore } from "@/stores/scoring-store"

vi.hoisted(() => {
  const storage = new Map<string, string>()
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  } })
})

const MATCH = "00000000-0000-4000-8000-000000000001"
function innings(number = 1) {
  return {
    matchId: MATCH, innings: number, inningsId: "00000000-0000-4000-8000-000000000002",
    teamId: "00000000-0000-4000-8000-000000000003", status: "in_progress",
    totalRuns: 20, totalWickets: 1, totalBalls: 6, overs: 1, balls: 0, runRate: 20,
    extras: 5, wides: 2, noBalls: 1, byes: 1, legByes: 1, updatedAt: "2026-10-12T12:00:00.000Z",
  }
}
function snapshot() {
  return { version: 2, matchId: MATCH, status: "live", currentInnings: 1,
    updatedAt: "2026-10-12T12:00:00.000Z", innings1: innings() }
}
function apply(input: unknown) {
  useScoringStore.setState(reconcileLiveState(useScoringStore.getState(), input))
}

describe("Full live snapshot reconciliation", () => {
  beforeEach(() => useScoringStore.setState({
    matchId: MATCH, innings1: null, innings2: null, superOver: null,
    matchStatus: "scheduled", matchUpdatedAt: undefined,
  }))

  it("initializes a null innings on a fresh spectator visit", () => {
    apply(snapshot())
    expect(useScoringStore.getState().innings1).toMatchObject({
      inningsId: innings().inningsId, teamId: innings().teamId, totalRuns: 20,
      extras: 5, wides: 2, byes: 1, currentOver: 1, currentBall: 0, balls: [],
    })
  })

  it("retains completed status through reconnect and initializes the chase", () => {
    apply({ ...snapshot(), status: "innings_break", currentInnings: 2,
      innings1: { ...innings(), status: "completed" }, innings2: innings(2) })
    expect(useScoringStore.getState()).toMatchObject({ matchStatus: "innings_break", currentInnings: 2,
      innings1: { status: "completed" }, innings2: { status: "in_progress" } })
  })

  it("initializes super-over innings instead of dropping it", () => {
    apply({ ...snapshot(), currentInnings: 3, superOver: innings(3) })
    expect(useScoringStore.getState()).toMatchObject({ currentInnings: "super_over", superOver: { totalRuns: 20 } })
  })

  it("does not roll back a newer innings when a stale join snapshot arrives", () => {
    apply(snapshot())
    apply({ ...snapshot(), innings1: { ...innings(), totalRuns: 30, updatedAt: "2026-10-12T12:00:02.000Z" } })
    apply(snapshot())
    expect(useScoringStore.getState().innings1?.totalRuns).toBe(30)
  })

  it("allows a newer authoritative undo to reduce runs", () => {
    apply(snapshot())
    apply({ ...snapshot(), innings1: { ...innings(), totalRuns: 15, updatedAt: "2026-10-12T12:00:02.000Z" } })
    expect(useScoringStore.getState().innings1?.totalRuns).toBe(15)
  })

  it("preserves unconfirmed offline deliveries instead of overwriting optimistic accounting", () => {
    apply(snapshot())
    const store = useScoringStore.getState()
    store.addBall({ input: 1, runs: 1, overNumber: 1, ballNumber: 1,
      isWicket: false, isWide: false, isNoBall: false, isBye: false, isLegBye: false })
    apply(snapshot())
    expect(useScoringStore.getState().innings1?.totalRuns).toBe(21)
    expect(useScoringStore.getState().innings1?.balls).toHaveLength(1)
  })

  // SCORE-11 (Batch 176): the reconcile carry/discard decision on
  // `local.inningsId === remote.inningsId` — coded since the live-state
  // layer shipped but never pinned. Server-CONFIRMED balls (any id NOT
  // carrying the offline `ball-` prefix) survive a newer authoritative
  // snapshot of the SAME innings; a snapshot bearing a DIFFERENT innings
  // identity discards them — carrying ball history across two different
  // innings objects would invent deliveries the server never recorded.
  it("carries server-confirmed balls through a newer snapshot of the same innings", () => {
    apply(snapshot())
    const confirmedBall = {
      id: "00000000-0000-4000-8000-00000000004b",
      overNumber: 1, ballNumber: 1, input: 4 as const, runs: 4,
      isWicket: false, isWide: false, isNoBall: false, isBye: false, isLegBye: false,
      timestamp: Date.parse("2026-10-12T12:00:01.000Z"),
    }
    useScoringStore.setState({ innings1: { ...useScoringStore.getState().innings1!, balls: [confirmedBall] } })
    apply({ ...snapshot(), innings1: { ...innings(), totalRuns: 24, updatedAt: "2026-10-12T12:00:05.000Z" } })
    const innings1 = useScoringStore.getState().innings1!
    expect(innings1.totalRuns).toBe(24) // accounting still authoritative
    expect(innings1.inningsId).toBe(innings().inningsId)
    expect(innings1.balls).toEqual([confirmedBall]) // same innings: history carried
    expect(innings1.lastSnapshotAt).toBe("2026-10-12T12:00:05.000Z")
  })

  it("discards local balls when the snapshot carries a different innings identity", () => {
    apply(snapshot())
    const confirmedBall = {
      id: "00000000-0000-4000-8000-00000000004c",
      overNumber: 1, ballNumber: 1, input: 6 as const, runs: 6,
      isWicket: false, isWide: false, isNoBall: false, isBye: false, isLegBye: false,
      timestamp: Date.parse("2026-10-12T12:00:01.000Z"),
    }
    useScoringStore.setState({ innings1: { ...useScoringStore.getState().innings1!, balls: [confirmedBall] } })
    apply({ ...snapshot(), innings1: { ...innings(),
      inningsId: "00000000-0000-4000-8000-000000000004", totalRuns: 25,
      updatedAt: "2026-10-12T12:00:05.000Z" } })
    const innings1 = useScoringStore.getState().innings1!
    expect(innings1.inningsId).toBe("00000000-0000-4000-8000-000000000004")
    expect(innings1.totalRuns).toBe(25)
    expect(innings1.balls).toEqual([]) // different innings: stale history never carried
  })

  it.each([null, {}, { ...snapshot(), matchId: "00000000-0000-4000-8000-000000000099" },
    { ...snapshot(), innings1: { ...innings(), extras: -1 } }])("ignores invalid/cross-match traffic %s", (input) => {
    expect(reconcileLiveState(useScoringStore.getState(), input)).toEqual({})
  })

  it("clears another match's innings and history on navigation", () => {
    apply(snapshot())
    useScoringStore.getState().setMatchId("other-match")
    expect(useScoringStore.getState()).toMatchObject({ matchId: "other-match", innings1: null,
      innings2: null, superOver: null, currentInnings: 1, matchUpdatedAt: undefined })
  })
})
