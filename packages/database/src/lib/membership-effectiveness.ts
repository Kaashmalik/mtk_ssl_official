/**
 * Shared membership-effectiveness policy (SCORE-09).
 *
 * A league membership grants access only while it is `active` AND not past its
 * optional `expires_at` bound. This module is the single source of truth for
 * that decision so the canonical scoring boundary, web server actions and any
 * future consumer agree; suspension and expiry are independent, and an expired
 * row is NOT reactivated by clearing status.
 *
 * Fail-closed: an unknown/missing status or an unparseable expiry never grants
 * access. The comparison uses the caller's clock; the caller is responsible for
 * having serialized against concurrent membership updates (the scoring boundary
 * holds the membership row lock before reading).
 */
export interface EffectivenessMembership {
  status: string | null | undefined
  expiresAt: Date | string | null | undefined
}

/**
 * An ISO-8601 instant string or Date; returns null when absent or malformed
 * so the caller can distinguish "no bound" from "malformed bound" (the latter
 * is a data corruption signal the DB CHECK should have prevented).
 */
export function parseMembershipExpiry(value: EffectivenessMembership["expiresAt"]): Date | null {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value !== "string" || value.length === 0) return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/** True only when the membership currently grants league access. */
export function membershipGrantsAccess(membership: EffectivenessMembership, now: Date = new Date()): boolean {
  if (!membership || membership.status !== "active") return false
  const expiry = parseMembershipExpiry(membership.expiresAt)
  if (expiry === null) {
    // A present-but-malformed bound is corruption, not an open door.
    return membership.expiresAt === null || membership.expiresAt === undefined
  }
  return expiry.getTime() > now.getTime()
}
