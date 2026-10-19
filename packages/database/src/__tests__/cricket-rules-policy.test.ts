import { describe, expect, it } from "vitest"

/**
 * SCORE-10 (Batch 154): the cricket rules fold. Pins the conversion
 * knots every scorer hits: illegal deliveries never advance display
 * coordinates or complete overs; strike swaps on odd crossed runs and
 * again at over-end (double-swap cancels); all dismissal modes remove
 * the striker except named run-outs and retirements; an innings closes
 * on target reached, all-out (XI-1 wickets, or the declared count),
 * or overs exhausted - decided by state, never by hope.
 */
import {
  batterLeavingOnWicket,
  inningsShouldClose,
  isLegalDelivery,
  nextDisplayPosition,
  rotateStrike,
  superOverShouldClose,
  SUPER_OVER_WICKETS,
} from "@mtk/database"

describe("SCORE-10 (Batch 154): cricket rules fold", () => {
  it("never treats a wide or no-ball as a legal delivery, but byes and leg-byes are legal", () => {
    expect(isLegalDelivery([])).toBe(true)
    expect(isLegalDelivery(["wide"])).toBe(false)
    expect(isLegalDelivery(["noball"])).toBe(false)
    expect(isLegalDelivery(["bye"])).toBe(true)
    expect(isLegalDelivery(["legbye"])).toBe(true)
  })

  it("advances display coordinates only on legal balls; the over completes on the sixth legal ball", () => {
    expect(nextDisplayPosition(3, 1, [])).toEqual({ ok: true, overNumber: 3, ballNumber: 2, overJustCompleted: false })
    expect(nextDisplayPosition(3, 6, [])).toEqual({ ok: true, overNumber: 4, ballNumber: 1, overJustCompleted: true })
    // A wide on ball 6 re-bowls: same coordinates, over can NOT complete.
    expect(nextDisplayPosition(3, 6, ["wide"])).toEqual({ ok: true, overNumber: 3, ballNumber: 6, overJustCompleted: false })
    expect(nextDisplayPosition(3, 6, ["noball"]).ok).toBe(true)
    const closed = nextDisplayPosition(3, 7, [])
    expect(closed).toEqual({ ok: false, reason: "over_already_complete" })
  })

  it("rotates strike on odd crossed runs, at every over end, and cancels the double swap", () => {
    const A = { strikerId: "a", nonStrikerId: "b" }
    expect(rotateStrike(A, 0, false)).toEqual({ rotated: false, reason: "even_runs_or_partial_over" })
    expect(rotateStrike(A, 2, false)).toEqual({ rotated: false, reason: "even_runs_or_partial_over" })
    expect(rotateStrike(A, 1, false)).toEqual({ rotated: true, state: { strikerId: "b", nonStrikerId: "a" } })
    expect(rotateStrike(A, 0, true)).toEqual({ rotated: true, state: { strikerId: "b", nonStrikerId: "a" } })
    // Odd runs INTO an over end: swapped once by the runs, the over-end
    // swap returns them - a boundary to finish the over does not flip the
    // strike twice.
    expect(rotateStrike(A, 3, true)).toEqual({ rotated: true, state: { strikerId: "a", nonStrikerId: "b" } })
  })

  it("removes the striker for conventional dismissals, and only the named batter for run-outs and retirements", () => {
    expect(batterLeavingOnWicket("bowled", "a", "b")).toEqual({ outBatterId: "a", kind: "dismissed" })
    expect(batterLeavingOnWicket("caught", "a", "b")).toEqual({ outBatterId: "a", kind: "dismissed" })
    expect(batterLeavingOnWicket("lbw", "a", "b")).toEqual({ outBatterId: "a", kind: "dismissed" })
    expect(batterLeavingOnWicket("stumped", "a", "b")).toEqual({ outBatterId: "a", kind: "dismissed" })
    expect(batterLeavingOnWicket("hit_wicket", "a", "b")).toEqual({ outBatterId: "a", kind: "dismissed" })
    // Run-out: the SCORER names the batter - default striker, but the
    // non-striker is legal and a stranger is refused outright.
    expect(batterLeavingOnWicket("run_out", "a", "b")).toEqual({ outBatterId: "a", kind: "dismissed" })
    expect(batterLeavingOnWicket("run_out", "a", "b", "b")).toEqual({ outBatterId: "b", kind: "dismissed" })
    expect(batterLeavingOnWicket("run_out", "a", "b", "c")).toEqual({ ok: false, reason: "dismissed_player_not_on_strike_ends" })
    // Retired is not a dismissal.
    expect(batterLeavingOnWicket("retired", "a", "b", "b")).toEqual({ outBatterId: "b", kind: "retired" })
    expect(batterLeavingOnWicket("retired_hurt", "a", "b")).toEqual({ outBatterId: "a", kind: "retired" })
  })

  it("closes an innings on state: target first, then all-out, then overs - otherwise it stays open", () => {
    const base = { battingXICount: 11, wicketsLost: 3, oversAllowed: 20, oversCompleted: 10, totalRuns: 80, targetRuns: 150 }
    expect(inningsShouldClose(base)).toEqual({ closed: false, reason: "innings_open" })
    expect(inningsShouldClose({ ...base, totalRuns: 150 })).toEqual({ closed: true, reason: "target_reached", winnerReachedTarget: true })
    expect(inningsShouldClose({ ...base, wicketsLost: 10 })).toEqual({ closed: true, reason: "all_out" })
    expect(inningsShouldClose({ ...base, oversCompleted: 20 })).toEqual({ closed: true, reason: "overs_exhausted" })
    // A side that declared short is all out when ITS declared batters
    // have batted - 8 declared means 7 wickets end the innings.
    expect(inningsShouldClose({ ...base, battingXICount: 8, wicketsLost: 7 })).toEqual({ closed: true, reason: "all_out" })
    // Wickets can never exceed the declared ceiling.
    expect(inningsShouldClose({ ...base, battingXICount: 0, wicketsLost: 0 }).closed).toBe(true)
  })

  it("sizes the super over: two wickets or the fixed ball count, whichever ends it first", () => {
    expect(SUPER_OVER_WICKETS).toBe(2)
    expect(superOverShouldClose(1, 4, 6)).toBe(false)
    expect(superOverShouldClose(2, 4, 6)).toBe(true)
    expect(superOverShouldClose(0, 6, 6)).toBe(true)
  })
})
