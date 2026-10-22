import { describe, expect, it } from "vitest"
import { queuedDeliveryToCommand, recordBallCommandSchema, scoringParticipantsSchema, type ScoringParticipants } from "../scoring"
import { buildBroadcastOverlaySnapshot, type BroadcastOverlaySnapshot } from "../broadcast-overlay"
import {
  planBroadcastCelebrations,
  pruneBroadcastCelebrations,
} from "../broadcast-celebrations"

/**
 * Batch 100 (ENH-03-02 / ENH-09-02): canonical wicket attribution carried by
 * the flattened command, and the confirmable participant projection that
 * gates player-introduction celebrations.
 */

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const STRIKER = uuid(11)
const NONSTRIKER = uuid(12)
const NEW_BATTER = uuid(13)
const BOWLER = uuid(21)
const BOWLER2 = uuid(22)
const FIELDER = uuid(31)

const validCommand = {
  matchId: uuid(1),
  inningsId: uuid(2),
  clientOpId: "op-1",
  queueAccountId: uuid(3),
  queueTenantId: uuid(4),
  overNumber: 0,
  ballNumber: 1,
  runs: 1,
  batsmanId: STRIKER,
  bowlerId: BOWLER,
  isWicket: true,
  wicketType: "run_out",
}

describe("Batch 100: wicket attribution on the flattened command", () => {
  it("accepts optional scorer-named attribution without a version bump", () => {
    const parsed = recordBallCommandSchema.parse({
      ...validCommand,
      wicketPlayerOutId: NONSTRIKER,
      wicketFielderId: FIELDER,
    })
    expect(parsed.wicketPlayerOutId).toBe(NONSTRIKER)
    expect(parsed.wicketFielderId).toBe(FIELDER)
  })

  it("still validates v1 queued commands that omit attribution entirely", () => {
    const parsed = recordBallCommandSchema.parse(validCommand)
    expect(parsed.wicketPlayerOutId).toBeUndefined()
    expect(parsed.wicketFielderId).toBeUndefined()
  })

  it("carries the attribution fields through the offline queue adapter", () => {
    const command = queuedDeliveryToCommand({
      id: validCommand.clientOpId,
      matchId: validCommand.matchId,
      inningsId: validCommand.inningsId,
      over: 0,
      ball: 1,
      runs: 1,
      batsmanId: STRIKER,
      bowlerId: BOWLER,
      isWicket: true,
      wicketType: "run_out",
      wicketPlayerOutId: NONSTRIKER,
      wicketFielderId: FIELDER,
    })
    if (!command.ok) throw new Error(command.reason)
    expect(command.command.wicketPlayerOutId).toBe(NONSTRIKER)
    expect(command.command.wicketFielderId).toBe(FIELDER)
  })
})

describe("Batch 100: overlay participants projection", () => {
  function snapshotInput(participants: ScoringParticipants | null, ballsCount = 2) {
    return {
      match: {
        id: uuid(1),
        tenantId: uuid(4),
        status: "live",
        scoringRevision: 12,
        updatedAt: "2026-10-22T10:00:00.000Z",
        totalOvers: 20,
        teamAId: uuid(41),
        teamBId: uuid(42),
      },
      teams: [
        { id: uuid(41), name: "Lions", logoUrl: null },
        { id: uuid(42), name: "Tigers", logoUrl: null },
      ],
      innings: [
        { inningsNumber: 1, teamId: uuid(41), totalRuns: 150, totalWickets: 7, totalBalls: 120 },
        { inningsNumber: 2, teamId: uuid(42), totalRuns: 4, totalWickets: 0, totalBalls: ballsCount },
      ],
      balls: Array.from({ length: ballsCount }, (_, index) => ({
        id: `ball-${index + 1}`,
        inningsNumber: 2,
        runs: 4,
        isWicket: false,
        isWide: false,
        isNoBall: false,
        isBye: false,
        isLegBye: false,
        isFour: true,
        isSix: false,
        batsmanId: STRIKER,
        bowlerId: BOWLER,
        wicketType: null,
      })),
      players: [
        { id: STRIKER, name: "A. Batter" },
        { id: NONSTRIKER, name: "B. Partner" },
        { id: BOWLER, name: "B. Bowler" },
        { id: NEW_BATTER, name: "C. Incoming" },
      ],
      branding: { name: "SSL", logoUrl: null, primaryColor: null, secondaryColor: null },
      participants,
    }
  }

  it("stays aggregate-only when the fold did not run (participants null)", () => {
    const snapshot = buildBroadcastOverlaySnapshot(snapshotInput(null))
    expect(snapshot.current?.participants).toBeNull()
  })

  it("projects confirmed striker/non-striker/bowler figures from the fold", () => {
    const participants = scoringParticipantsSchema.parse({
      strikerId: STRIKER,
      nonStrikerId: NONSTRIKER,
      bowlerId: BOWLER,
      previousOverBowlerId: null,
      incomingBatterId: NEW_BATTER,
      creaseBatterIds: [STRIKER, NONSTRIKER],
      confirmed: true,
      lastBallSequence: 2,
    })
    const snapshot = buildBroadcastOverlaySnapshot(snapshotInput(participants))
    expect(snapshot.current?.participants).toMatchObject({
      confirmed: true,
      lastBallSequence: 2,
      striker: { id: STRIKER, name: "A. Batter", runs: 8, balls: 2 },
      nonStriker: { id: NONSTRIKER, name: "B. Partner", runs: 0, balls: 0 },
      bowler: { id: BOWLER, name: "B. Bowler", balls: 2, runs: 8, wickets: 0 },
      incomingBatter: { id: NEW_BATTER, name: "C. Incoming" },
      previousBowlerId: null,
      crease: [{ id: STRIKER }, { id: NONSTRIKER }],
    })
  })

  it("carries the fold's unconfirmed flag untouched for the renderer's honesty gate", () => {
    const participants = scoringParticipantsSchema.parse({
      strikerId: null,
      nonStrikerId: null,
      bowlerId: null,
      previousOverBowlerId: BOWLER,
      incomingBatterId: null,
      creaseBatterIds: [],
      confirmed: false,
      lastBallSequence: 2,
    })
    const snapshot = buildBroadcastOverlaySnapshot(snapshotInput(participants))
    expect(snapshot.current?.participants?.confirmed).toBe(false)
    expect(snapshot.current?.participants?.previousBowlerId).toBe(BOWLER)
  })
})

describe("Batch 100: player-introduction celebrations", () => {
  function celebratorySnapshot(participants: ScoringParticipants | null, ballsCount: number, revision: number): BroadcastOverlaySnapshot {
    return buildBroadcastOverlaySnapshot({
      match: {
        id: uuid(1),
        tenantId: uuid(4),
        status: "live",
        scoringRevision: revision,
        updatedAt: "2026-10-22T10:00:01.000Z",
        totalOvers: 20,
        teamAId: uuid(41),
        teamBId: uuid(42),
      },
      teams: [
        { id: uuid(41), name: "Lions", logoUrl: null },
        { id: uuid(42), name: "Tigers", logoUrl: null },
      ],
      innings: [
        { inningsNumber: 2, teamId: uuid(42), totalRuns: 5, totalWickets: 1, totalBalls: ballsCount },
      ],
      balls: Array.from({ length: ballsCount }, (_, index) => ({
        id: `ball-${index + 1}`,
        inningsNumber: 2,
        runs: 0,
        isWicket: false,
        isWide: false,
        isNoBall: false,
        isBye: false,
        isLegBye: false,
        isFour: false,
        isSix: false,
        batsmanId: STRIKER,
        bowlerId: BOWLER,
        wicketType: null,
      })),
      players: [
        { id: STRIKER, name: "A. Batter" },
        { id: BOWLER, name: "B. Bowler" },
        { id: BOWLER2, name: "C. Bowler" },
        { id: NEW_BATTER, name: "C. Incoming" },
      ],
      branding: { name: "SSL", logoUrl: null, primaryColor: null, secondaryColor: null },
      participants,
    })
  }

  it("emits batter_entered ONLY from a confirmed incoming projection", () => {
    const previous = celebratorySnapshot(scoringParticipantsSchema.parse({
      strikerId: STRIKER, nonStrikerId: null, bowlerId: BOWLER, previousOverBowlerId: null,
      incomingBatterId: null, creaseBatterIds: [STRIKER], confirmed: true, lastBallSequence: 1,
    }), 1, 13)
    const next = celebratorySnapshot(scoringParticipantsSchema.parse({
      strikerId: NEW_BATTER, nonStrikerId: STRIKER, bowlerId: BOWLER, previousOverBowlerId: null,
      incomingBatterId: NEW_BATTER, creaseBatterIds: [STRIKER, NEW_BATTER], confirmed: true, lastBallSequence: 2,
    }), 2, 14)
    const events = planBroadcastCelebrations({ previous, next })
    const entered = events.filter(event => event.kind === "batter_entered")
    expect(entered).toHaveLength(1)
    expect(entered[0]).toMatchObject({ title: "NEW BATTER", detail: "C. Incoming", ballId: "ball-2" })
  })

  it("never emits introductions from an unconfirmed fold", () => {
    const previous = celebratorySnapshot(null, 1, 13)
    const next = celebratorySnapshot(scoringParticipantsSchema.parse({
      strikerId: NEW_BATTER, nonStrikerId: STRIKER, bowlerId: BOWLER, previousOverBowlerId: null,
      incomingBatterId: NEW_BATTER, creaseBatterIds: [STRIKER, NEW_BATTER], confirmed: false, lastBallSequence: 2,
    }), 2, 14)
    const events = planBroadcastCelebrations({ previous, next })
    expect(events.some(event => event.kind === "batter_entered")).toBe(false)
    expect(events.some(event => event.kind === "bowler_entered")).toBe(false)
  })

  it("announces a bowler change across the between-overs gap via the boundary anchor", () => {
    const previous = celebratorySnapshot(scoringParticipantsSchema.parse({
      strikerId: STRIKER, nonStrikerId: null, bowlerId: null, previousOverBowlerId: BOWLER,
      incomingBatterId: null, creaseBatterIds: [STRIKER], confirmed: true, lastBallSequence: 1,
    }), 1, 13)
    const next = celebratorySnapshot(scoringParticipantsSchema.parse({
      strikerId: STRIKER, nonStrikerId: null, bowlerId: BOWLER2, previousOverBowlerId: null,
      incomingBatterId: null, creaseBatterIds: [STRIKER], confirmed: true, lastBallSequence: 2,
    }), 2, 14)
    const events = planBroadcastCelebrations({ previous, next })
    const entered = events.filter(event => event.kind === "bowler_entered")
    expect(entered).toHaveLength(1)
    expect(entered[0]).toMatchObject({ title: "NEW BOWLER", detail: "C. Bowler bowling" })
  })

  it("does not re-announce the same bowler while they remain in the attack", () => {
    const confirmed = scoringParticipantsSchema.parse({
      strikerId: STRIKER, nonStrikerId: null, bowlerId: BOWLER, previousOverBowlerId: null,
      incomingBatterId: null, creaseBatterIds: [STRIKER], confirmed: true, lastBallSequence: 1,
    })
    const previous = celebratorySnapshot(confirmed, 1, 13)
    const next = celebratorySnapshot({ ...confirmed, lastBallSequence: 2 }, 2, 14)
    const events = planBroadcastCelebrations({ previous, next })
    expect(events.some(event => event.kind === "bowler_entered")).toBe(false)
  })

  it("does not re-announce the same incoming batter while the introduction is live", () => {
    const confirmed = scoringParticipantsSchema.parse({
      strikerId: NEW_BATTER, nonStrikerId: STRIKER, bowlerId: BOWLER, previousOverBowlerId: null,
      incomingBatterId: NEW_BATTER, creaseBatterIds: [STRIKER, NEW_BATTER], confirmed: true, lastBallSequence: 2,
    })
    const previous = celebratorySnapshot(confirmed, 2, 14)
    const next = celebratorySnapshot({ ...confirmed, lastBallSequence: 3 }, 3, 15)
    const events = planBroadcastCelebrations({ previous, next })
    expect(events.some(event => event.kind === "batter_entered")).toBe(false)
  })

  it("retracts a queued introduction when an undo removes the revealing delivery", () => {
    const confirmedIncoming = scoringParticipantsSchema.parse({
      strikerId: NEW_BATTER, nonStrikerId: STRIKER, bowlerId: BOWLER, previousOverBowlerId: null,
      incomingBatterId: NEW_BATTER, creaseBatterIds: [STRIKER, NEW_BATTER], confirmed: true, lastBallSequence: 2,
    })
    const previous = celebratorySnapshot(scoringParticipantsSchema.parse({
      strikerId: STRIKER, nonStrikerId: null, bowlerId: BOWLER, previousOverBowlerId: null,
      incomingBatterId: null, creaseBatterIds: [STRIKER], confirmed: true, lastBallSequence: 1,
    }), 1, 13)
    const next = celebratorySnapshot(confirmedIncoming, 2, 14)
    const queued = planBroadcastCelebrations({ previous, next })
      .filter(event => event.kind === "batter_entered")
    expect(queued).toHaveLength(1)
    // Undo: the revealing delivery is gone from official record, revision climbed.
    const afterUndo = celebratorySnapshot(
      scoringParticipantsSchema.parse({
        strikerId: STRIKER, nonStrikerId: null, bowlerId: BOWLER, previousOverBowlerId: null,
        incomingBatterId: null, creaseBatterIds: [STRIKER], confirmed: true, lastBallSequence: 1,
      }), 1, 15)
    expect(pruneBroadcastCelebrations(queued, afterUndo)).toHaveLength(0)
  })
})
