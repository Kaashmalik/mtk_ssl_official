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
    tossWinnerId: "team-b", tossDecision: "bat", updatedAt: new Date("2026-10-12T12:00:00.000Z"),
    handoverEpoch: 4, scoringRevision: 8 },
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
    superOver: null, matchUpdatedAt: undefined, currentInnings: 1, handoverEpoch: undefined, scoringRevision: undefined }))
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
  it("refreshes the observed handover epoch alongside a fresh match read", () => {
    apply()
    expect(useScoringStore.getState().handoverEpoch).toBe(4)
  })
  it("never lowers the observed epoch from a stale database response", () => {
    // A newer local view (post-handover socket read) must not be downgraded by
    // a response captured before the assignment writer bumped the epoch.
    useScoringStore.setState({ handoverEpoch: 9, matchUpdatedAt: "2026-10-12T12:00:30.000Z" })
    apply()
    expect(useScoringStore.getState().handoverEpoch).toBe(9)
  })
  it("initializes session metadata even when the socket scoreboard is newer", () => {
    useScoringStore.setState({ matchUpdatedAt: "2026-10-12T12:00:30.000Z" })
    apply()
    expect(useScoringStore.getState().handoverEpoch).toBe(4)
  })
  it("does not reauthorize pending deliveries after a handover or reload", async () => {
    apply()
    useScoringStore.getState().addBall({ input: 1, runs: 1, overNumber: 1, ballNumber: 1, isWicket: false,
      isWide: false, isNoBall: false, isBye: false, isLegBye: false })
    const next = fixture()
    next.match.handoverEpoch = 5
    expect(hydrateScoringState(useScoringStore.getState(), next)).toEqual({})
    const saved = localStorage.getItem("scoring-storage")!
    expect(JSON.parse(saved).state.handoverEpoch).toBe(4)
    useScoringStore.setState({ handoverEpoch: undefined })
    // Restore the saved session as Zustand would on a reload.
    localStorage.setItem("scoring-storage", saved)
    await useScoringStore.persist.rehydrate()
    apply(next)
    expect(useScoringStore.getState().handoverEpoch).toBe(4)
  })
  it("clears the previous match's epoch when switching matches", () => {
    apply()
    useScoringStore.getState().setMatchId("another-match")
    expect(useScoringStore.getState().handoverEpoch).toBeUndefined()
  })
  it("reserves stable ordered revisions for offline deliveries and never lowers confirmed state", () => {
    apply()
    const add = () => useScoringStore.getState().addBall({ input: 1, runs: 1, overNumber: 1, ballNumber: 1, isWicket: false,
      isWide: false, isNoBall: false, isBye: false, isLegBye: false })
    add()
    add()
    const balls = useScoringStore.getState().innings2!.balls
    expect(balls.map(ball => ball.expectedRevision)).toEqual([8, 9])
    useScoringStore.getState().acknowledgeBall(balls[0].id, "canonical", "op-1", 9)
    useScoringStore.getState().observeScoringRevision(2)
    expect(useScoringStore.getState().scoringRevision).toBe(9)
    expect(useScoringStore.getState().innings2!.balls[1].expectedRevision).toBe(9)
    useScoringStore.getState().setMatchId("another")
    expect(useScoringStore.getState().scoringRevision).toBeUndefined()
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
