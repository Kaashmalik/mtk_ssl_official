/**
 * Membership expiry display classification (IAM-02, rule v1). Pure; the
 * source of truth for whether access is granted remains the shared
 * membership-effectiveness policy — this module only renders state.
 */
// Deep import, not the barrel: this module is imported by CLIENT components
// (users list). The `@mtk/database` barrel pulls in the postgres driver, which
// cannot bundle for the browser. membership-effectiveness is pure.
import { parseMembershipExpiry } from "@mtk/database/lib/membership-effectiveness"

export type MembershipExpiryState = "unbounded" | "live" | "expired" | "invalid"

export type MembershipExpiryDisplay = {
  state: MembershipExpiryState
  /** Short label for badges/list rows, e.g. "Expires 1 Nov 2026" / "Expired". */
  short: string
  /** Longer explanation for detail surfaces. */
  detail: string
}

export function membershipExpiryDisplay(
  expiresAt: Date | string | null | undefined,
  now: Date = new Date(),
): MembershipExpiryDisplay {
  const unbounded: MembershipExpiryDisplay = {
    state: "unbounded",
    short: "No expiry",
    detail: "This membership has no expiry bound; it grants access while active.",
  }
  if (expiresAt === null || expiresAt === undefined) return unbounded
  const bound = parseMembershipExpiry(expiresAt)
  if (bound === null) {
    // Fail-closed display: the effectiveness policy does not grant access.
    return {
      state: "invalid",
      short: "Bound unparseable",
      detail: "The stored expiry bound is unparseable (data corruption signal). Access is withheld by policy.",
    }
  }
  const dateText = bound.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
  if (bound.getTime() > now.getTime()) {
    return {
      state: "live",
      short: `Expires ${dateText}`,
      detail: `This bounded membership grants access until ${dateText} (league time), then stops automatically.`,
    }
  }
  return {
    state: "expired",
    short: `Expired ${dateText}`,
    detail: `This membership's bound passed on ${dateText}. Reactivating it requires the owner to clear or extend the expiry, not just the status.`,
  }
}
