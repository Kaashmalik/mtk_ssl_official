/**
 * REG-05 (Batch 138): pure availability policy. The status set is fixed and
 * self-answering is a recorded journey, not a guess: a member may record
 * availability for a match in a league they are an ACTIVE member of, for the
 * match only while it is still plannable (terminal results can no longer
 * benefit from an availability answer - those are refused rather than stored
 * and shown forever as if newly given).
 */

export const AVAILABILITY_STATUSES = ["available", "unavailable", "maybe"] as const
export type AvailabilityStatus = (typeof AVAILABILITY_STATUSES)[number]

export const AVAILABILITY_LABELS: Record<AvailabilityStatus, string> = {
  available: "Available",
  unavailable: "Unavailable",
  maybe: "Maybe",
}

export const AVAILABILITY_DESCRIPTIONS: Record<AvailabilityStatus, string> = {
  available: "I can play this match",
  unavailable: "I cannot play this match",
  maybe: "Not sure yet",
}

/** Matches whose outcome is decided can no longer be planned for. */
export const AVAILABILITY_TERMINAL_MATCH_STATUSES = ["completed", "cancelled", "abandoned"] as const

export function isAvailabilityStatus(status: string): status is AvailabilityStatus {
  return (AVAILABILITY_STATUSES as readonly string[]).includes(status)
}

/**
 * The recorded decision: whether a member's answer may be stored for this
 * match. Fails closed on anything not explicitly plannable.
 */
export function availabilityDecision(match: {
  tenantId: string
  status?: string | null
}): { ok: true } | { ok: false; reason: string } {
  if (AVAILABILITY_TERMINAL_MATCH_STATUSES.includes((match.status ?? "") as never)) {
    return { ok: false, reason: "This match is finished - availability can no longer be recorded" }
  }
  return { ok: true }
}

export function availabilityLabel(status: string): string {
  return isAvailabilityStatus(status) ? AVAILABILITY_LABELS[status] : "Unknown"
}
