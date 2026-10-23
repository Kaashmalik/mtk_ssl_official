import { describe, expect, it } from "vitest"
import {
  dueHeldCelebrations,
  ingestHeldCelebrations,
  normalizeEventOffsetMs,
  pruneQueuedCelebrations,
} from "@/lib/broadcast-latency-buffer"
import {
  buildBroadcastOverlaySnapshot,
  type BroadcastCelebrationEvent,
  type BroadcastOverlaySnapshot,
} from "@mtk/contracts"

/**
 * ENH-09-04 (Batch 101): celebration latency sequencing. The offset holds
 * ANIMATED EVENTS only; undo pruning still reaches into the buffer, dedup
 * absorbs duplicate plans, and reveal order/CAP semantics match the on-screen
 * queue contract.
 */

const STRIKER = "00000000-0000-4000-8000-0000000000b1"
const BOWLER = "00000000-0000-4000-8000-0000000000c1"
function snapshot(balls: Array<{ id: string; isSix: boolean }>, revision: number): BroadcastOverlaySnapshot {
  return buildBroadcastOverlaySnapshot({
    match: {
      id: "00000000-0000-4000-8000-0000000000a1",
      tenantId: "00000000-0000-4000-8000-0000000000a2",
      status: "live",
      scoringRevision: revision,
      updatedAt: "2026-10-23T10:00:00.000Z",
      totalOvers: 20,
      teamAId: "00000000-0000-4000-8000-0000000000d1",
      teamBId: "00000000-0000-4000-8000-0000000000d2",
    },
    teams: [
      { id: "00000000-0000-4000-8000-0000000000d1", name: "Lions", logoUrl: null },
      { id: "00000000-0000-4000-8000-0000000000d2", name: "Tigers", logoUrl: null },
    ],
    innings: [
      { inningsNumber: 2, teamId: "00000000-0000-4000-8000-0000000000d2", totalRuns: balls.filter(b => b.isSix).length * 6, totalWickets: 0, totalBalls: balls.length },
    ],
    balls: balls.map((ball, index) => ({
      id: ball.id,
      inningsNumber: 2,
      runs: ball.isSix ? 6 : 1,
      isWicket: false,
      isWide: false,
      isNoBall: false,
      isBye: false,
      isLegBye: false,
      isFour: false,
      isSix: ball.isSix,
      batsmanId: STRIKER,
      bowlerId: BOWLER,
      wicketType: null,
      _index: index,
    })) as Parameters<typeof buildBroadcastOverlaySnapshot>[0]["balls"],
    players: [
      { id: STRIKER, name: "A. Batter" },
      { id: BOWLER, name: "B. Bowler" },
    ],
    branding: { name: "SSL", logoUrl: null, primaryColor: null, secondaryColor: null },
    participants: null,
  })
}

function sixEvent(id: string, ballId: string): BroadcastCelebrationEvent {
  return {
    id,
    kind: "six",
    title: "SIX",
    detail: null,
    revision: 1,
    ballId,
  }
}

const BALL_A = "00000000-0000-4000-8000-0000000000e1"
const BALL_B = "00000000-0000-4000-8000-0000000000e2"

describe("Batch 101: celebration latency buffer", () => {
  const base = snapshot([{ id: BALL_A, isSix: true }], 1)

  it("holds a planned event until its reveal time, then releases it FIFO", () => {
    const first = ingestHeldCelebrations({
      planned: [sixEvent("e-a", BALL_A)],
      held: [],
      seenIds: new Set(),
      snapshot: base,
      now: 10_000,
      offsetMs: 2_500,
    })
    expect(dueHeldCelebrations(first.held, 10_000).due).toEqual([])
    expect(dueHeldCelebrations(first.held, 12_499).due).toEqual([])
    const released = dueHeldCelebrations(first.held, 12_500)
    expect(released.due.map(event => event.id)).toEqual(["e-a"])
    expect(released.held).toHaveLength(0)
  })

  it("absorbs a duplicate plan of the same event while it is still held", () => {
    const first = ingestHeldCelebrations({
      planned: [sixEvent("e-a", BALL_A)],
      held: [],
      seenIds: new Set(),
      snapshot: base,
      now: 0,
      offsetMs: 5_000,
    })
    const second = ingestHeldCelebrations({
      planned: [sixEvent("e-a", BALL_A)],
      held: first.held,
      seenIds: first.seenIds,
      snapshot: base,
      now: 1_000,
      offsetMs: 5_000,
    })
    expect(second.held).toHaveLength(1)
    // The original reveal time survives a duplicate plan.
    expect(dueHeldCelebrations(second.held, 4_999).due).toEqual([])
    expect(dueHeldCelebrations(second.held, 5_000).due).toHaveLength(1)
  })

  it("an undo prunes a held event before reveal AND forgets its dedup id", () => {
    const first = ingestHeldCelebrations({
      planned: [sixEvent("e-a", BALL_A)],
      held: [],
      seenIds: new Set(),
      snapshot: base,
      now: 0,
      offsetMs: 5_000,
    })
    // The undone record is gone from official history, revision climbs.
    const afterUndo = snapshot([], 2)
    const second = ingestHeldCelebrations({
      planned: [],
      held: first.held,
      seenIds: first.seenIds,
      snapshot: afterUndo,
      now: 1_000,
      offsetMs: 5_000,
    })
    expect(second.held).toHaveLength(0)
    expect(second.seenIds.has("e-a")).toBe(false)
    // So a corrected re-plan can claim the event again from official truth.
    const replan = ingestHeldCelebrations({
      planned: [sixEvent("e-a", BALL_A)],
      held: second.held,
      seenIds: second.seenIds,
      snapshot: base,
      now: 2_000,
      offsetMs: 5_000,
    })
    expect(replan.held).toHaveLength(1)
  })

  it("orders simultaneous reveals deterministically and keeps later events held", () => {
    const first = ingestHeldCelebrations({
      planned: [sixEvent("e-b", BALL_B), sixEvent("e-a", BALL_A)],
      held: [],
      seenIds: new Set(),
      snapshot: snapshot([{ id: BALL_A, isSix: true }, { id: BALL_B, isSix: true }], 2),
      now: 0,
      offsetMs: 1_000,
    })
    const released = dueHeldCelebrations(first.held, 1_000)
    expect(released.due.map(event => event.id)).toEqual(["e-a", "e-b"])
    expect(released.held).toHaveLength(0)
  })

  it("reports forgotten queue ids on undo without touching held state", () => {
    const event = sixEvent("e-a", BALL_A)
    const result = pruneQueuedCelebrations([event], snapshot([], 2))
    expect(result.kept).toHaveLength(0)
    expect(result.forgottenIds).toEqual(["e-a"])
    const untouched = pruneQueuedCelebrations([event], base)
    expect(untouched.kept).toEqual([event])
    expect(untouched.forgottenIds).toEqual([])
  })

  it("clamps the offset through the shared policy", () => {
    expect(normalizeEventOffsetMs(2_500)).toBe(2_500)
    expect(normalizeEventOffsetMs(-1)).toBe(0)
    expect(normalizeEventOffsetMs(99_999)).toBe(30_000)
  })
})
