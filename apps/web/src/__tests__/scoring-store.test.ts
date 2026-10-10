import { beforeEach, describe, expect, it, vi } from "vitest"
import { useScoringStore, type BallData, type InningsState } from "@/stores/scoring-store"

// Use real persistence behavior with a test-local storage adapter (no browser).
vi.hoisted(() => {
  const values = new Map<string, string>()
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  } })
})

const emptyInnings: InningsState = {
  inningsId: "innings-1", teamId: "team-1", totalRuns: 0, totalWickets: 0,
  totalBalls: 0, extras: 0, byes: 0, legByes: 0, wides: 0, noBalls: 0,
  status: "in_progress", currentOver: 0, currentBall: 0, balls: [],
}

function delivery(input: Partial<BallData> = {}) {
  return {
    overNumber: 0, ballNumber: 1, input: 0 as const, runs: 0, isWicket: false,
    isWide: false, isNoBall: false, isBye: false, isLegBye: false, ...input,
  }
}

describe("Scorer local state agrees with authoritative accounting", () => {
  beforeEach(() => useScoringStore.setState({
    matchId: "match-1", currentInnings: 1, innings1: { ...emptyInnings, balls: [] },
    innings2: null, superOver: null,
    innings1History: { history: [], historyIndex: -1 },
  }))

  it("counts a no-ball plus four bat runs as five total and one extra", () => {
    useScoringStore.getState().addBall(delivery({ input: "NB", runs: 5, isNoBall: true }))
    expect(useScoringStore.getState().innings1).toMatchObject({ totalRuns: 5, extras: 1, totalBalls: 0, noBalls: 1 })
    expect(useScoringStore.getState().innings1?.balls[0].isFour).toBe(true)
  })

  it("includes byes and leg-byes in extras and legal balls", () => {
    useScoringStore.getState().addBall(delivery({ input: "B", runs: 4, isBye: true }))
    useScoringStore.getState().addBall(delivery({ input: "LB", runs: 2, isLegBye: true }))
    expect(useScoringStore.getState().innings1).toMatchObject({ totalRuns: 6, extras: 6, byes: 4, legByes: 2, totalBalls: 2 })
  })

  it("displays six legal deliveries as 1.0 and keeps wides at that position", () => {
    for (let count = 0; count < 6; count++) useScoringStore.getState().addBall(delivery())
    useScoringStore.getState().addBall(delivery({ input: "WD", runs: 1, isWide: true }))
    expect(useScoringStore.getState().innings1).toMatchObject({
      totalBalls: 6, currentOver: 1, currentBall: 0,
    })
  })

  it("preserves acknowledged IDs in undo snapshots", () => {
    const store = useScoringStore.getState()
    store.addBall(delivery({ input: 1, runs: 1 }))
    const localId = useScoringStore.getState().innings1!.balls[0].id
    store.addBall(delivery({ input: 2, runs: 2 }))
    store.acknowledgeBall(localId, "server-ball-id", "stable-op-id")
    store.undo()
    expect(useScoringStore.getState().innings1?.balls[0]).toMatchObject({
      id: "server-ball-id", clientOpId: "stable-op-id",
    })
  })

  it("applies confirmed undo after reload without relying on local history", () => {
    useScoringStore.setState({ innings1: {
      ...emptyInnings, totalRuns: 5, extras: 5, wides: 1,
      balls: [{ ...delivery({ input: "WD", runs: 5, isWide: true }), id: "server-ball", timestamp: 1 }],
    }, innings1History: { history: [], historyIndex: -1 } })
    useScoringStore.getState().applyConfirmedUndo("server-ball", emptyInnings)
    expect(useScoringStore.getState().innings1).toMatchObject({ totalRuns: 0, extras: 0, wides: 0, balls: [] })
  })
})
