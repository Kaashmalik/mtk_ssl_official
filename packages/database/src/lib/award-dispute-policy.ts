/**
 * PUB-04 award-dispute policy (pure, shared).
 *
 * A dispute is a RECORD, never a mutation: raising one does not change the
 * award, and even an UPHELD dispute never auto-supersedes the declaration —
 * the owner separately corrects the award through the Batch 88 supersede path.
 * Dispute review and award declaration stay separate authorities all the way
 * down (DB resolution CHECK here, writer-side authority separation there).
 *
 * Reason vocabulary is a FIXED set (nothing offensive is storable; no free
 * text in this first slice — a longer dispute brief is recorded future work).
 */

export const AWARD_DISPUTE_REASONS = [
  "incorrect_winner",
  "winner_ineligible",
  "process_error",
  "other",
] as const

export type AwardDisputeReason = (typeof AWARD_DISPUTE_REASONS)[number]

export const AWARD_DISPUTE_REASON_LABELS: Record<AwardDisputeReason, string> = {
  incorrect_winner: "A different player or team won",
  winner_ineligible: "The winner did not meet the award's criteria",
  process_error: "The selection process was not followed",
  other: "Another reason the owner should review",
}

export function isAwardDisputeReason(value: unknown): value is AwardDisputeReason {
  return typeof value === "string" && (AWARD_DISPUTE_REASONS as readonly string[]).includes(value)
}

export type AwardDisputeRow = {
  id: string
  awardId: string
  raisedBy: string
  status: "open" | "upheld" | "dismissed"
  resolvedAt?: Date | string | null
}

export type AwardDisputeDecision = "upheld" | "dismissed"

/**
 * The only legal transitions: open -> upheld, open -> dismissed. Already-
 * decided rows are terminal (the DB CHECK + writer both refuse a re-decision;
 * a fresh dispute after a decision is a NEW record, a different challenge).
 */
export function canResolveDispute(
  row: Pick<AwardDisputeRow, "status"> | null | undefined,
): boolean {
  return row != null && row.status === "open"
}

/** Label for the owner's queue and the member's own dispute history. */
export function disputeStatusLabels(status: AwardDisputeRow["status"]): string {
  switch (status) {
    case "open": return "Awaiting review"
    case "upheld": return "Upheld — owner review granted"
    case "dismissed": return "Dismissed — award stands"
  }
}
