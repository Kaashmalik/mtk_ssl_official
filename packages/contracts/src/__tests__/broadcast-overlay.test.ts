import { describe, expect, it } from "vitest"
import {
  broadcastBallLabel,
  buildBroadcastOverlaySnapshot,
  formatOverlayOvers,
} from "../broadcast-overlay"

/** ENH-09-01: the overlay projection is display-only and arithmetic-honest. */

const ball = {
  inningsNumber: 2,
  runs: 1,
  isWicket: false,
  isWide: false,
  isNoBall: false,
  isBye: false,
  isLegBye: false,
  isFour: false,
  isSix: false,
  batsmanId: "00000000-0000-4000-8000-0000000000b1",
  bowlerId: "00000000-0000-4000-8000-0000000000c1",
  wicketType: null,
}

function input(overrides: Partial<Parameters<typeof buildBroadcastOverlaySnapshot>[0]> = {}) {
  return {
    match: {
      id: "00000000-0000-4000-8000-0000000000a1",
      tenantId: "00000000-0000-4000-8000-0000000000a2",
      status: "live",
      updatedAt: "2026-10-21T10:00:00.000Z",
      totalOvers: 20,
      teamAId: "00000000-0000-4000-8000-0000000000d1",
      teamBId: "00000000-0000-4000-8000-0000000000d2",
    },
    teams: [
      { id: "00000000-0000-4000-8000-0000000000d1", name: "Lions", logoUrl: null },
      { id: "00000000-0000-4000-8000-0000000000d2", name: "Tigers", logoUrl: "https://res.cloudinary.com/x/logo.png" },
    ],
    innings: [
      { inningsNumber: 1, teamId: "00000000-0000-4000-8000-0000000000d1", totalRuns: 150, totalWickets: 7, totalBalls: 120 },
      { inningsNumber: 2, teamId: "00000000-0000-4000-8000-0000000000d2", totalRuns: 100, totalWickets: 3, totalBalls: 60 },
    ],
    balls: [
      { ...ball, runs: 4, isFour: true },
      { ...ball, runs: 0, isWide: true },
      { ...ball, runs: 1, isNoBall: true },
      { ...ball, runs: 2, isBye: true },
      { ...ball, runs: 6, isSix: true },
      { ...ball, runs: 0, isWicket: true, wicketType: "run_out" },
    ],
    players: [
      { id: "00000000-0000-4000-8000-0000000000b1", name: "A. Batter" },
      { id: "00000000-0000-4000-8000-0000000000c1", name: "B. Bowler" },
    ],
    branding: { name: "SSL", logoUrl: null, primaryColor: "#123456", secondaryColor: null },
    ...overrides,
  }
}

describe("ENH-09-01: overlay projection", () => {
  it("formats overs without floating-point drift", () => {
    expect(formatOverlayOvers(0)).toBe("0.0")
    expect(formatOverlayOvers(61)).toBe("10.1")
    expect(formatOverlayOvers(-1)).toBe("0.0")
  })

  it("labels extras and wickets truthfully", () => {
    expect(broadcastBallLabel({ ...ball, isWide: true, runs: 1 })).toEqual({ label: "WD", tone: "extra" })
    expect(broadcastBallLabel({ ...ball, isNoBall: true, runs: 2 })).toEqual({ label: "NB", tone: "extra" })
    expect(broadcastBallLabel({ ...ball, isBye: true, runs: 2 })).toEqual({ label: "B2", tone: "extra" })
    expect(broadcastBallLabel({ ...ball, isWicket: true })).toEqual({ label: "W", tone: "wicket" })
    expect(broadcastBallLabel({ ...ball, runs: 0 })).toEqual({ label: "•", tone: "run" })
  })

  it("projects the chase target and aggregate figures", () => {
    const snapshot = buildBroadcastOverlaySnapshot(input())
    expect(snapshot.league.name).toBe("SSL")
    expect(snapshot.teams.teamA).toMatchObject({ name: "Lions", runs: 150, wickets: 7, overs: "20.0" })
    expect(snapshot.current).toMatchObject({
      inningsNumber: 2,
      runs: 100,
      wickets: 3,
      overs: "10.0",
      target: 151,
    })
    expect(snapshot.current?.requiredRate).toBe("5.10")
    expect(snapshot.current?.recentBalls.map(row => row.label))
      .toEqual(["4", "WD", "NB", "B2", "6", "W"])
    // Batter: 4 + 0 wide + 0 no-ball (1-1) + 0 bye + 6 + 0 = 10 from 5 balls
    // (wides are not balls faced; the no-ball is).
    expect(snapshot.current?.lastBatter).toMatchObject({
      name: "A. Batter", runs: 10, balls: 5,
    })
    // Bowler: 4 + 0 wide + 1 no-ball + 0 bye + 6 + 0 run-out = 11, 4 legal
    // balls, and a run-out is not credited to the bowler.
    expect(snapshot.current?.lastBowler).toMatchObject({
      name: "B. Bowler", runs: 11, balls: 4, wickets: 0,
    })
  })

  it("returns no current innings before scoring starts", () => {
    expect(buildBroadcastOverlaySnapshot(input({ innings: [], balls: [] })).current).toBeNull()
  })
})
