/**
 * REG-05 (Batch 141): pure correction-request policy. Requests are
 * RECORDS, never mutations - the vocabulary is fixed (nothing offensive
 * or free-form is storable in this slice), only active league members
 * may raise, and only while the match's scorecard can still receive a
 * reviewed correction (terminal-but-recorded matches keep their
 * scorecards correctable; outright deleted/absent ones have nothing to
 * correct). The reviewer must hold the league owner authority.
 */

export const CORRECTION_REASONS = [
  "wrong_runs",
  "wrong_wicket",
  "wrong_batter",
  "missing_player",
  "other",
] as const
export type CorrectionReason = (typeof CORRECTION_REASONS)[number]

export const CORRECTION_REASON_LABELS: Record<CorrectionReason, string> = {
  wrong_runs: "Wrong runs on the scoreboard",
  wrong_wicket: "Wicket recorded incorrectly",
  wrong_batter: "Wrong batter credited",
  missing_player: "A player is missing from the scorecard",
  other: "Something else is wrong",
}

export const CORRECTION_STATUSES = ["open", "approved", "dismissed"] as const
export type CorrectionStatus = (typeof CORRECTION_STATUSES)[number]

export function isCorrectionReason(reason: string): reason is CorrectionReason {
  return (CORRECTION_REASONS as readonly string[]).includes(reason)
}

export function isCorrectionStatus(status: string): status is CorrectionStatus {
  return (CORRECTION_STATUSES as readonly string[]).includes(status)
}

export function correctionReasonLabel(reason: string): string {
  return isCorrectionReason(reason) ? CORRECTION_REASON_LABELS[reason] : "Unknown"
}

/**
 * Whether a correction request may be raised for this match state. The
 * scorecard must EXIST in some form (innings recorded); a match that
 * never started has nothing to correct - the honest refusal is "no
 * scorecard yet", not a fake acceptance.
 */
export function correctionRequestDecision(match: {
  tenantId: string
  status?: string | null
}): { ok: true } | { ok: false; reason: string } {
  const status = match.status ?? ""
  if (status === "draft" || status === "registration") {
    return { ok: false, reason: "This match has no scorecard yet" }
  }
  return { ok: true }
}
