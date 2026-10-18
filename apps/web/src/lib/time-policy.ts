/**
 * UX-03 display-timezone policy. Pure (node-testable), no db or auth.
 *
 * Honesty rule carried over from `formatDashboardDate`: a user without a
 * configured timezone sees an explicit "UTC" label - the server's zone is
 * never imputed as theirs. A configured zone must be one `Intl.DateTimeFormat`
 * actually accepts; anything else falls back to the UTC-labelled rendering
 * (fail-closed to the previous honest behavior, never an exception).
 */

/** The fallback label suffix - byte-identical to the pre-Batch-114 behavior. */
export const UTC_FALLBACK_SUFFIX = " UTC"

/** Curated IANA choices offered in the account card. All must be Intl-valid. */
export const DISPLAY_TIME_ZONE_OPTIONS = [
  "UTC",
  "Asia/Karachi",
  "Asia/Kolkata",
  "Asia/Dhaka",
  "Asia/Colombo",
  "Asia/Kabul",
  "Asia/Dubai",
  "Asia/Riyadh",
  "Asia/Singapore",
  "Asia/Kuala_Lumpur",
  "Africa/Johannesburg",
  "Europe/London",
  "Europe/Paris",
  "Australia/Sydney",
  "Pacific/Auckland",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "America/Toronto",
] as const

/** `true` iff Intl can format with this zone id (the single source of validity). */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone })
    return true
  } catch {
    return false
  }
}

/** A stored preference is usable only if Intl accepts it. */
export function isUsableDisplayTimeZone(timeZone: string | null | undefined): timeZone is string {
  return typeof timeZone === "string" && isValidTimeZone(timeZone)
}
