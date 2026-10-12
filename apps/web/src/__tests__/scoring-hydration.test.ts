import { beforeEach, describe, expect, it, vi } from "vitest"
import { hydrateScoringState, type ScoringPageSnapshot } from "@/lib/scoring-hydration"
import { useScoringStore } from "@/stores/scoring-store"

vi.hoisted(() => {
  const storage = new Map<string, string>()
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  } })
})
const MATCH = "match-1"
function fixture() {
  // Only the database projection consumed by hydration is relevant here.
  return { match: { id: MATCH, status: "live", teamAId: "team-a", teamBId: "team-b",
    tossWinnerId: "team-b", tossDecision: "bat", updatedAt: new Date("2026-10-12T12:00:00.000Z") },
    innings: [row(1), row(2)], recentBalls: [] } as unknown as ScoringPageSnapshot
}
function row(number: number) {
  return { id: `innings-${number}`, inningsNumber: number, teamId: number === 1 ? "team-b" : "team-a",
    totalRuns: 5, totalWickets: 0, totalBalls: 6, extras: 2, wides: 2, noBalls: 0, byes: 0, legByes: 0,
    status: "in_progress", updatedAt: new Date("2026-10-12T12:00:00.000Z") }
}
function apply(snapshot = fixture()) {
  useScoringStore.setState(hydrateScoringState(useScoringStore.getState(), snapshot))
}
describe("Scorer page reload hydration", () => {
  beforeEach(() => useScoringStore.setState({ matchId: MATCH, innings1: null, innings2: null,
    superOver: null, matchUpdatedAt: undefined, currentInnings: 1 }))
  it("restores the current chase instead of resetting every reload to innings one", () => {
    apply()
    expect(useScoringStore.getState()).toMatchObject({ currentInnings: 2,
      innings1: { teamId: "team-b" }, innings2: { teamId: "team-a", currentOver: 1, currentBall: 0 } })
  })
  it("restores a super over", () => {
    const snapshot = fixture()
    snapshot.innings.push(row(3) as ScoringPageSnapshot["innings"][number])
    apply(snapshot)
    expect(useScoringStore.getState()).toMatchObject({ currentInnings: "super_over", superOver: { inningsId: "innings-3" } })
  })
  it("chooses the batting team from the toss for a not-yet-created innings", () => {
    const snapshot = fixture()
    snapshot.innings = []
    apply(snapshot)
    expect(useScoringStore.getState().innings1?.teamId).toBe("team-b")
    snapshot.match.tossDecision = "bowl"
    apply(snapshot)
    expect(useScoringStore.getState().innings1?.teamId).toBe("team-a")
  })
  it("retains unconfirmed local deliveries during a reload", () => {
    apply()
    const store = useScoringStore.getState()
    store.addBall({ input: 1, runs: 1, overNumber: 1, ballNumber: 1, isWicket: false,
      isWide: false, isNoBall: false, isBye: false, isLegBye: false })
    expect(hydrateScoringState(useScoringStore.getState(), fixture())).toEqual({})
    expect(useScoringStore.getState().innings2?.totalRuns).toBe(6)
  })
  it("does not replace a newer socket snapshot with an older database response", () => {
    apply()
    const local = useScoringStore.getState().innings2!
    useScoringStore.setState({ innings2: { ...local, totalRuns: 30, lastSnapshotAt: "2026-10-12T12:00:01.000Z" } })
    apply()
    expect(useScoringStore.getState().innings2?.totalRuns).toBe(30)
  })
  it("keeps database operation IDs and orders repeated extras by sequence", () => {
    const snapshot = fixture()
    snapshot.recentBalls = [3, 1, 2].map((ballSequence) => ({
      id: `server-ball-${ballSequence}`, inningsId: "innings-1", ballSequence,
      clientOpId: `op-${ballSequence}`, overNumber: 0, ballNumber: 1, isWide: true,
      runs: 1, createdAt: new Date("2026-10-12T12:00:00.000Z"),
    })) as ScoringPageSnapshot["recentBalls"]
    apply(snapshot)
    expect(useScoringStore.getState().innings1?.balls.map((ball) => ball.clientOpId)).toEqual(["op-1", "op-2", "op-3"])
  })
})
