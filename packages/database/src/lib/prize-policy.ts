/**
 * PUB-05 tournament-prize policy (pure, shared).
 *
 * Single source of truth for the prize lifecycle (draft -> approved), when a
 * payout may be recorded, and what the public gallery may eventually show. The
 * lifecycle is deliberately small and one-way: drafts are league-editable,
 * approval freezes the row as recorded truth, and a recorded payout is the
 * LEAGUE'S OWN record — the platform never verifies fund transfer, so nothing
 * here may present a payout record as a platform-verified fact.
 *
 * Enum-free by design for categories: prize categories and placements are
 * league-defined free text (configurable), unlike PUB-04's fixed award set.
 * The writer bounds their shape; this module owns the state machine only.
 */

export const PRIZE_STATUSES = ["draft", "approved"] as const
export type PrizeStatus = (typeof PRIZE_STATUSES)[number]

export type PrizeLifecycleRow = {
  status?: string | null
  recordedPayoutAt?: Date | string | null
}

/** Only a draft is editable — approval freezes the row as recorded truth. */
export function prizeCanBeEdited(row: PrizeLifecycleRow | null | undefined): boolean {
  return !!row && row.status === "draft"
}

/** Approval is the one-way draft -> approved transition; replays are no-ops. */
export function prizeCanBeApproved(row: PrizeLifecycleRow | null | undefined): boolean {
  return !!row && row.status === "draft"
}

/**
 * A payout may be recorded exactly once, and only for an approved prize. An
 * unapproved prize has no confirmed value to pay out; a second record would
 * either duplicate or silently rewrite the league's payout history.
 */
export function prizePayoutRecordable(row: PrizeLifecycleRow | null | undefined): boolean {
  return !!row && row.status === "approved" && row.recordedPayoutAt == null
}

export type PrizeVisibilityRow = {
  status?: string | null
}

/**
 * Visible on a public tournament surface: an APPROVED prize only, shown only
 * for a tournament the publication policy already admits (the caller must
 * apply the published-tournament gate). Drafts and ambiguous rows fail closed.
 */
export function isPrizePubliclyVisible(
  row: PrizeVisibilityRow | null | undefined,
  tournamentPublished: boolean,
): boolean {
  if (!row || !tournamentPublished) return false
  return row.status === "approved"
}

/**
 * Normalizes a prize amount to the exact 2dp numeric(12,2) string the column
 * stores. Rejects negatives, more than 2 decimal places and absurd magnitudes
 * rather than silently rounding — a prize record that looks right but is off
 * by rounding is worse than a rejected input.
 */
export function normalizePrizeAmount(raw: string): string | null {
  const trimmed = raw.trim()
  if (!/^(0|[1-9]\d{0,11})(\.\d{1,2})?$/.test(trimmed)) return null
  const [whole, decimals = ""] = trimmed.split(".")
  return `${whole}.${(decimals + "00").slice(0, 2)}`
}

/** Upper bound matching the numeric(12,2) column (up to 9,999,999,999.99). */
export const PRIZE_AMOUNT_MAX = "9999999999.99"

/** Bounded public gallery size; the page discloses incompleteness beyond this. */
export const PUBLIC_PRIZE_LIMIT = 20
