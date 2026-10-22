import { describe, expect, it } from "vitest"
import {
  planBroadcastCelebrations,
  pruneBroadcastCelebrations,
  type BroadcastCelebrationEvent,
  type BroadcastOverlaySnapshot,
} from "../index"

/**
 * ENH-09-02/03: celebrations are a pure diff of OFFICIAL snapshots.
 *
 * The tests pin the honesty rules: stable delivery ids dedupe replays, byes are
 * never boundaries, run-outs are not bowler-credited, undo cancels a queued
 * event, and a reconnect baseline emits no backlog.
 */

const BASE: BroadcastOverlaySnapshot = {
  matchId: "00000000-0000-4000-8000-0000000000a1",
  tenantId: "00000000-0000-4000-8000-0000000000a2",
  status: "live",
  scoringRevision: 10,
  updatedAt: "2026-10-22T10:00:00.000Z",
  league: { name: "SSL", logoUrl: null, primaryColor: "#16a34a", secondaryColor: "#0f172a" },
  teams: {
    teamA: { id: "A", name: "Lions", logoUrl: null, runs: 80, wickets: 1, overs: "10.0" },
    teamB: { id: "B", name: "Tigers", logoUrl: null, runs: 0, wickets: 0, overs: "0.0" },
  },
  current: {
    inningsNumber: 1,
    battingTeamId: "A",
    runs: 80,
    wickets: 1,
    overs: "10.0",
    runRate: "8.00",
    target: null,
    requiredRate: null,
    recentBalls: [
      {
        id: "ball-1",
        key: "ball-1",
        label: "1",
        tone: "run",
        wicketType: null,
        bowlerCreditedWicket: false,
      },
    ],
    lastBatter: { id: "batter-1", name: "A. Batter", runs: 40, balls: 30 },
    lastBowler: { id: "bowler-1", name: "B. Bowler", balls: 24, runs: 20, wickets: 2 },
  },
}

function snap(overrides: {
  revision?: number
  status?: string
  runs?: number
  inningsNumber?: number
  recentBalls?: BroadcastOverlaySnapshot["current"] extends infer _ ? Array<{
    id: string
    label: string
    tone: "run" | "boundary" | "wicket" | "extra"
    wicketType?: string | null
    bowlerCreditedWicket?: boolean
  }> : never
  lastBatter?: { id: string; name: string; runs: number; balls: number } | null
  lastBowler?: { id: string; name: string; balls: number; runs: number; wickets: number } | null
}): BroadcastOverlaySnapshot {
  const current = BASE.current!
  return {
    ...BASE,
    status: overrides.status ?? BASE.status,
    scoringRevision: overrides.revision ?? BASE.scoringRevision,
    current: {
      ...current,
      inningsNumber: overrides.inningsNumber ?? current.inningsNumber,
      runs: overrides.runs ?? current.runs,
      recentBalls: (overrides.recentBalls ?? current.recentBalls).map(ball => ({
        wicketType: ball.wicketType ?? null,
        bowlerCreditedWicket: ball.bowlerCreditedWicket ?? false,
        key: ball.id,
        ...ball,
      })),
      lastBatter: overrides.lastBatter === undefined ? current.lastBatter : overrides.lastBatter,
      lastBowler: overrides.lastBowler === undefined ? current.lastBowler : overrides.lastBowler,
    },
  }
}

function events(previous: BroadcastOverlaySnapshot | null, next: BroadcastOverlaySnapshot) {
  return planBroadcastCelebrations({ previous, next })
}

describe("ENH-09-02/03: celebration planning", () => {
  it("emits nothing for a first render/reconnect baseline or an unchanged snapshot", () => {
    expect(events(null, snap({}))).toEqual([])
    expect(events(snap({}), snap({}))).toEqual([])
  })

  it("emits four, six and wicket from new official delivery ids", () => {
    const result = events(
      snap({}),
      snap({
        revision: 11,
        recentBalls: [
          ...BASE.current!.recentBalls,
          { id: "ball-2", label: "4", tone: "boundary" },
          { id: "ball-3", label: "6", tone: "boundary" },
          {
            id: "ball-4", label: "W", tone: "wicket",
            wicketType: "bowled", bowlerCreditedWicket: true,
          },
        ],
      }),
    )
    expect(result.map(event => event.kind)).toEqual(["four", "six", "wicket"])
    expect(result.map(event => event.ballId))
      .toEqual(["ball-2", "ball-3", "ball-4"])
    expect(result.at(-1)).toMatchObject({ bowlerCreditedWicket: true })
  })

  it("never turns a bye/leg-bye into a boundary", () => {
    expect(events(snap({}), snap({
      revision: 11,
      recentBalls: [
        ...BASE.current!.recentBalls,
        { id: "ball-2", label: "B4", tone: "extra" },
      ],
    }))).toEqual([])
  })

  it("never turns an overthrow four into a bat boundary", () => {
    expect(events(snap({}), snap({
      revision: 11,
      recentBalls: [
        ...BASE.current!.recentBalls,
        // `runs: 4` without the canonical bat-boundary tone (e.g. overthrows).
        { id: "ball-2", label: "4", tone: "run" },
      ],
    }))).toEqual([])
  })

  it("labels a run-out as not credited to the bowler", () => {
    const [event] = events(snap({}), snap({
      revision: 11,
      recentBalls: [
        ...BASE.current!.recentBalls,
        {
          id: "ball-2", label: "W", tone: "wicket",
          wicketType: "run_out", bowlerCreditedWicket: false,
        },
      ],
    }))
    expect(event).toMatchObject({ kind: "wicket", bowlerCreditedWicket: false })
    expect(event.detail).toContain("not credited")
  })

  it("emits a batter milestone only for the same confirmed batter", () => {
    const result = events(
      snap({ lastBatter: { id: "batter-1", name: "A. Batter", runs: 49, balls: 35 } }),
      snap({
        revision: 11,
        runs: 81,
        lastBatter: { id: "batter-1", name: "A. Batter", runs: 51, balls: 36 },
        recentBalls: [
          ...BASE.current!.recentBalls,
          { id: "ball-2", label: "2", tone: "run" },
        ],
      }),
    )
    expect(result).toContainEqual(expect.objectContaining({
      kind: "batter_fifty", title: "FIFTY", ballId: "ball-2",
    }))
  })

  it("emits team and five-wicket milestones, and an innings break", () => {
    const fifty = events(
      snap({ runs: 49, lastBowler: { id: "bowler-1", name: "B. Bowler", balls: 24, runs: 20, wickets: 4 } }),
      snap({
        revision: 11,
        runs: 51,
        lastBowler: { id: "bowler-1", name: "B. Bowler", balls: 25, runs: 21, wickets: 5 },
        recentBalls: [
          ...BASE.current!.recentBalls,
          {
            id: "ball-2", label: "W", tone: "wicket",
            wicketType: "bowled", bowlerCreditedWicket: true,
          },
        ],
      }),
    )
    expect(fifty.map(event => event.kind))
      .toEqual(expect.arrayContaining(["team_fifty", "five_wickets"]))

    const breakEvent = events(snap({}), snap({
      revision: 30,
      inningsNumber: 2,
      recentBalls: [],
      lastBatter: null,
      lastBowler: null,
    }))
    expect(breakEvent).toContainEqual(expect.objectContaining({ kind: "innings_break" }))
  })

  it("emits a result only on a terminal transition", () => {
    expect(events(snap({ status: "live" }), snap({ revision: 40, status: "completed" })))
      .toContainEqual(expect.objectContaining({ kind: "result", title: "RESULT" }))
    expect(events(snap({ status: "live" }), snap({ revision: 41, status: "abandoned" })))
      .toContainEqual(expect.objectContaining({ kind: "result", title: "ABANDONED" }))
    expect(events(snap({ status: "completed" }), snap({ revision: 42, status: "completed" })))
      .toEqual([])
  })

  it("cancels a queued event when the delivery is undone", () => {
    const queued: BroadcastCelebrationEvent[] = [
      {
        id: "ball:ball-2", kind: "four", title: "FOUR", detail: null,
        revision: 11, ballId: "ball-2",
      },
      {
        id: "milestone:batter_fifty:batter-1:11", kind: "batter_fifty",
        title: "FIFTY", detail: "A. Batter 50", revision: 11, ballId: "ball-2",
      },
    ]
    const undone = snap({ revision: 12 })
    expect(pruneBroadcastCelebrations(queued, undone)).toEqual([])
    expect(events(snap({ revision: 11, recentBalls: [
      ...BASE.current!.recentBalls,
      { id: "ball-2", label: "4", tone: "boundary" },
    ] }), undone)).toEqual([])
  })

  it("retracts a queued result when the official match is reopened", () => {
    const queued: BroadcastCelebrationEvent[] = [{
      id: "result:completed:2026-10-22T11:00:00.000Z", kind: "result",
      title: "RESULT", detail: "Lions vs Tigers", revision: 20, ballId: null,
    }]
    expect(pruneBroadcastCelebrations(queued, snap({ revision: 21, status: "live" })))
      .toEqual([])
    expect(pruneBroadcastCelebrations(queued, snap({ revision: 21, status: "completed" })))
      .toHaveLength(1)
  })

  it("does not replay a backlog after the queue is primed", () => {
    const primed = snap({ revision: 20, recentBalls: [
      ...BASE.current!.recentBalls,
      { id: "ball-9", label: "6", tone: "boundary" },
    ] })
    // The component primes with the current snapshot and suppresses events on
    // reconnect; the pure planner itself treats `previous === null` as baseline.
    expect(events(null, primed)).toEqual([])
    expect(events(primed, primed)).toEqual([])
  })
})
