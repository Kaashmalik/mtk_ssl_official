/**
 * FAN-04 (Batch 164): the pure prediction policy. A prediction is a PRIVATE,
 * no-stakes member pick — never a bet, never a prize claim, and never
 * anything that touches an official score. Every gate returns a reason code
 * plus a member-facing sentence so the UI never invents copy.
 */

export const PREDICTION_PICKS = ["home", "away"] as const
export type PredictionPick = (typeof PREDICTION_PICKS)[number]

export function isPredictionPick(value: string): value is PredictionPick {
  return (PREDICTION_PICKS as readonly string[]).includes(value)
}

export type PredictionWindowState =
  | { open: true }
  | { open: false; reason: "match_underway" | "match_terminal" | "kickoff_passed" }

/** Statuses where the match can no longer be influenced or begun again. */
export const VOID_STATUSES = ["abandoned", "cancelled", "no_result", "forfeited", "postponed"] as const

/**
 * The prediction window: open ONLY while the match is still `scheduled`
 * and the scheduled kickoff (when recorded) has not passed. Once toss is
 * called or the wall clock crosses the scheduled date, picking is closed —
 * predicting mid-match would be outcome-peeking, which mocks the feature.
 */
export function predictionWindow(
  match: { status: string; scheduledDate: Date | string | null },
  now: Date,
): PredictionWindowState {
  if (match.status === "scheduled") {
    if (match.scheduledDate && new Date(match.scheduledDate).getTime() <= now.getTime()) {
      return { open: false, reason: "kickoff_passed" }
    }
    return { open: true }
  }
  if (match.status === "completed" || (VOID_STATUSES as readonly string[]).includes(match.status)) {
    return { open: false, reason: "match_terminal" }
  }
  return { open: false, reason: "match_underway" }
}

export function describePredictionWindow(state: PredictionWindowState): string {
  if (state.open) return "Predictions are open until the match begins."
  // `in`-guard, not a boolean-literal narrowing: scoring-service's tsconfig
  // runs with strictNullChecks=false, where TS 5.9 does NOT narrow
  // boolean-literal discriminants (office batch B164 regression).
  if (!("reason" in state)) return "Predictions are open until the match begins."
  if (state.reason === "kickoff_passed") return "Predictions are closed: the scheduled start time has passed."
  if (state.reason === "match_terminal") return "Predictions are closed: this match has a final outcome."
  return "Predictions are closed: the match is underway or has begun."
}

export type PredictionSettledVerdict =
  | { verdict: "correct"; winner: PredictionPick }
  | { verdict: "incorrect"; winner: PredictionPick }
  | { verdict: "void"; reason: string }
  | null // not settled yet — the honest "no verdict" state

/**
 * DERIVED settlement (never stored, never a write): from the official match
 * row only. `completed` with a winnerId resolves the verdict; any void
 * status is honest "no verdict" (picks are neither right nor wrong);
 * a completed match without a winner (e.g. a tied format) is void too.
 * A pick is NEVER rewritten to match the outcome, and an unsettleable state
 * stays null — never guessed.
 */
export function settlePrediction(
  pick: PredictionPick,
  match: { status: string; winnerId: string | null; teamAId: string; teamBId: string },
): PredictionSettledVerdict {
  if (match.status === "completed") {
    if (match.winnerId === match.teamAId) {
      return pick === "home" ? { verdict: "correct", winner: "home" } : { verdict: "incorrect", winner: "home" }
    }
    if (match.winnerId === match.teamBId) {
      return pick === "away" ? { verdict: "correct", winner: "away" } : { verdict: "incorrect", winner: "away" }
    }
    return { verdict: "void", reason: "no_recorded_winner" }
  }
  if ((VOID_STATUSES as readonly string[]).includes(match.status)) {
    return { verdict: "void", reason: `match_${match.status}` }
  }
  return null
}

export function describePredictionVerdict(
  verdict: Exclude<PredictionSettledVerdict, null>,
  teamAName: string,
  teamBName: string,
): string {
  if (verdict.verdict === "correct") {
    return `Your pick was correct: ${verdict.winner === "home" ? teamAName : teamBName} won.`
  }
  if (verdict.verdict === "incorrect") {
    return `Your pick did not come in: ${verdict.winner === "home" ? teamAName : teamBName} won.`
  }
  return "No verdict: this match ended without a recorded winner."
}

/** The honesty line every prediction surface must carry. */
export const PREDICTION_DISCLOSURE =
  "Just for fun, private to you and your league. No stakes, no prizes - and it never changes an official result."
