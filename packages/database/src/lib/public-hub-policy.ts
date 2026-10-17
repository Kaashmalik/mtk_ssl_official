/**
 * PUB-02 cross-league hub listing policy.
 *
 * Shared pure predicates so the owner-facing writer and the public hub reader
 * cannot drift. Everything fails closed: only an explicitly listed league with
 * a recorded listing time and an active tenant is eligible for cross-league
 * hub discovery. Anything ambiguous (missing enum value, missing timestamp,
 * deactivated tenant) is treated as unlisted.
 *
 * Strings, not boolean flags — consumers compile with `strictNullChecks`
 * variations and string literals always discriminate.
 */

export const HUB_LISTED = "listed"
export const HUB_UNLISTED = "unlisted"
export type HubListingStatus = "unlisted" | "listed"

export type HubListingRow = {
  hubListingStatus?: string | null
  hubListedAt?: Date | string | null
  isActive?: boolean | null
}

/**
 * Eligible for cross-league hub discovery: active + explicitly listed +
 * provenance timestamp present. A listed row without a timestamp is a data
 * inconsistency — fail closed instead of guessing.
 */
export function hubListingEligible(row: HubListingRow | null | undefined): boolean {
  if (!row || row.hubListingStatus !== HUB_LISTED) return false
  if (row.isActive !== true) return false
  return row.hubListedAt != null
}

/**
 * Validates an owner listing decision against the current state. Both
 * transitions are allowed; a decision matching the current state is a no-op
 * (the writer skips the write but still returns the resulting state).
 */
export function hubListingTransition(
  current: HubListingStatus | string | null | undefined,
  enable: boolean,
): { changed: boolean; status: HubListingStatus } {
  const status = current === HUB_LISTED ? HUB_LISTED : HUB_UNLISTED
  const next = enable ? HUB_LISTED : HUB_UNLISTED
  return { changed: status !== next, status: next }
}
