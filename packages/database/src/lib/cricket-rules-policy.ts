/**
 * SCORE-10 (Batch 154): full supported cricket rules as PURE POLICY. The
 * delivery schema already carries per-ball fidelity (wicket types, extras,
 * monotonic per-innings sequence); what it has never had is one shared
 * rules vocabulary. Every function here is a pure fold: no reads, no
 * writes, and named outcomes instead of booleans so callers can show WHY
 * a move is refused. Conversion knots (wide/no-ball never being legal
 * balls, strike rotation crossing runs, the batter who leaves on each
 * wicket type) live here and nowhere else.
 */

import type { ExtrasType } from "./scoring-delivery"

/** A legal delivery is any ball that is NOT a wide and NOT a no-ball.
 *  Byes and leg-byes are legal deliveries (the batter faced them). */
export function isLegalDelivery(extras: readonly ExtrasType[]): boolean {
  return !extras.includes("wide") && !extras.includes("noball")
}

/** Display coordinates advance ONLY on legal deliveries: a wide or a
 *  no-ball is re-bowled, so ballNumber stays and the over grows past six
 *  recorded balls. Refuses an over that is already finished. */
export type NextDisplayPosition =
  | { ok: true; overNumber: number; ballNumber: number; overJustCompleted: boolean }
  | { ok: false; reason: "over_already_complete" }

export function nextDisplayPosition(
  overNumber: number,
  ballNumber: number,
  extras: readonly ExtrasType[],
): NextDisplayPosition {
  if (!Number.isInteger(ballNumber) || ballNumber < 1 || ballNumber > 6) {
    return { ok: false, reason: "over_already_complete" }
  }
  if (!isLegalDelivery(extras)) {
    // Illegal delivery: re-bowled, no coordinate advance, over cannot
    // complete on it.
    return { ok: true, overNumber, ballNumber, overJustCompleted: false }
  }
  if (ballNumber === 6) {
    return { ok: true, overNumber: overNumber + 1, ballNumber: 1, overJustCompleted: true }
  }
  return { ok: true, overNumber, ballNumber: ballNumber + 1, overJustCompleted: false }
}

/** Strike rotation. Batters swap ends every ODD number of crossed runs
 *  (runs crossed excludes penalty conventions we do not support: wides
 *  plus byes combinations carry the standard crossing) and again at the
 *  end of every completed over. */export type StrikeState = { strikerId: string; nonStrikerId: string }
export type StrikeRotationResult =
  | { rotated: false; reason: "even_runs_or_partial_over" }
  | { rotated: true; state: StrikeState }

export function rotateStrike(state: StrikeState, runsCrossed: number, endOfOver: boolean): StrikeRotationResult {
  const crossed = Number.isInteger(runsCrossed) && runsCrossed > 0 ? runsCrossed : 0
  const oddRuns = crossed % 2 === 1
  if (!oddRuns && !endOfOver) return { rotated: false, reason: "even_runs_or_partial_over" }
  if (oddRuns && endOfOver) {
    // Odd runs swap once; the over-end swap cancels it back.
    return { rotated: true, state: { strikerId: state.strikerId, nonStrikerId: state.nonStrikerId } }
  }
  return { rotated: true, state: { strikerId: state.nonStrikerId, nonStrikerId: state.strikerId } }
}

/** Who leaves the field on a wicket. Every dismissal mode is striker-out
 *  EXCEPT run_out (the out batter is whichever one the scorer names -
 *  here the dismissed id is carried through) and retired (not a
 *  dismissal, the batter leaves voluntarily and may return where
 *  competition rules allow). The replacement never enters before the
 *  out batter is recorded. */
export type WicketExit =
  | { outBatterId: string; kind: "dismissed" }
  | { outBatterId: string; kind: "retired" }
  | { ok: false; reason: "dismissed_player_not_on_strike_ends" }

export function batterLeavingOnWicket(
  wicketType: "bowled" | "caught" | "lbw" | "stumped" | "hit_wicket" | "run_out" | "retired" | "retired_hurt",
  strikerId: string,
  nonStrikerId: string,
  dismissedBatterId?: string,
): WicketExit {
  if (wicketType === "run_out") {
    const out = dismissedBatterId ?? strikerId
    if (out !== strikerId && out !== nonStrikerId) {
      return { ok: false, reason: "dismissed_player_not_on_strike_ends" }
    }
    return { outBatterId: out, kind: "dismissed" }
  }
  if (wicketType === "retired" || wicketType === "retired_hurt") {
    const out = dismissedBatterId ?? strikerId
    if (out !== strikerId && out !== nonStrikerId) {
      return { ok: false, reason: "dismissed_player_not_on_strike_ends" }
    }
    return { outBatterId: out, kind: "retired" }
  }
  return { outBatterId: strikerId, kind: "dismissed" }
}

/** Innings closure, decided by state not by hope. An innings ends when
 *  the target is reached (chase won), the overs are exhausted, or the
 *  batting side is all out. All-out means every wicket EXCEPT one has
 *  fallen when the side has a full XI declared; a declared short side
 *  is all out when its DECLARED batters have all used their innings
 *  (that count is provided, never inferred). */
export type InningsClosureInput = {
  battingXICount: number
  wicketsLost: number
  oversAllowed: number
  oversCompleted: number
  totalRuns: number
  targetRuns?: number | null
}
export type InningsClosureResult =
  | { closed: true; reason: "target_reached"; winnerReachedTarget: true }
  | { closed: true; reason: "all_out" }
  | { closed: true; reason: "overs_exhausted" }
  | { closed: false; reason: "innings_open" }

export function inningsShouldClose(input: InningsClosureInput): InningsClosureResult {
  const xi = Math.max(1, Math.min(11, input.battingXICount))
  if (input.targetRuns != null && input.totalRuns >= input.targetRuns) {
    return { closed: true, reason: "target_reached", winnerReachedTarget: true }
  }
  if (input.wicketsLost >= xi - 1) return { closed: true, reason: "all_out" }
  if (input.oversCompleted >= input.oversAllowed) return { closed: true, reason: "overs_exhausted" }
  return { closed: false, reason: "innings_open" }
}

/** Super-over sizing: both sides face the same small number of legal
 *  deliveries and exactly 2 wickets (10 declared batters would be
 *  absurd - the super over ends at the second dismissal). */
export const SUPER_OVER_WICKETS = 2
export function superOverShouldClose(wicketsLost: number, legalBallsBowled: number, superOverBalls: number): boolean {
  return wicketsLost >= SUPER_OVER_WICKETS || legalBallsBowled >= superOverBalls
}

/** ENH-03-02: canonical active-participant state. The server states who it
 *  actually recorded on the last delivered ball and whether that striker
 *  slot can still be played - derived ONLY from the delivered record, never
 *  from a client's promise. The NON-striker is deliberately never claimed:
 *  only the next delivered ball names them, so no consumer may render
 *  automatic two-batter graphics from this alone. Official retirement
 *  semantics: `retired` (out) is a dismissal - the official record counts
 *  it as a wicket; `retired_hurt` is not - the batter may return. */
export interface CanonicalActiveParticipants {
  basis: "no_deliveries" | "last_delivery";
  lastBatsmanId: string | null;
  lastBowlerId: string | null;
  strikerSlot:
    | { state: "occupied" }
    | { state: "vacant"; reason: "dismissed" | "retired_out" }
    | { state: "open"; reason: "no_deliveries" | "retired_hurt_may_return" };
}

export function canonicalActiveParticipants(last: {
  batsmanId?: string | null;
  bowlerId?: string | null;
  wicketType?: string | null;
} | null | undefined): CanonicalActiveParticipants {
  const lastBatsmanId = last?.batsmanId ?? null;
  const lastBowlerId = last?.bowlerId ?? null;
  if (!lastBatsmanId || !lastBowlerId) {
    return { basis: "no_deliveries", lastBatsmanId: null, lastBowlerId: null, strikerSlot: { state: "open", reason: "no_deliveries" } };
  }
  const basis = "last_delivery" as const;
  const wicketType = last?.wicketType ?? null;
  if (wicketType === "retired_hurt") {
    return { basis, lastBatsmanId, lastBowlerId, strikerSlot: { state: "open", reason: "retired_hurt_may_return" } };
  }
  if (wicketType === "retired") {
    return { basis, lastBatsmanId, lastBowlerId, strikerSlot: { state: "vacant", reason: "retired_out" } };
  }
  if (wicketType) {
    return { basis, lastBatsmanId, lastBowlerId, strikerSlot: { state: "vacant", reason: "dismissed" } };
  }
  return { basis, lastBatsmanId, lastBowlerId, strikerSlot: { state: "occupied" } };
}
