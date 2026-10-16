/**
 * Invitation-proposed membership bound presets (SCORE-09, IAM-03). Pure
 * presentation helpers; the server action re-validates the serialized instant.
 * The membership bound is deliberately separate from the invitation link's
 * 7-day expiry: the link dies regardless, but the accepted membership may
 * carry a longer (or no) bound.
 */
export const invitationBoundPresets = [
  { value: "none", days: null, label: "No membership bound" },
  { value: "30", days: 30, label: "30 days" },
  { value: "90", days: 90, label: "90 days" },
  { value: "180", days: 180, label: "180 days" },
  { value: "365", days: 365, label: "1 year" },
] as const

export type InvitationBoundValue = (typeof invitationBoundPresets)[number]["value"]

/** Resolve a preset selection to the proposed bound instant; null = no bound. */
export function computeMembershipBound(value: string, now: Date = new Date()): Date | null {
  const preset = invitationBoundPresets.find(entry => entry.value === value)
  if (!preset || preset.days === null) return null
  return new Date(now.getTime() + preset.days * 24 * 60 * 60 * 1000)
}

/** Short list/detail rendering of a proposed bound. */
export function formatMembershipBound(bound: Date | string | null | undefined): string {
  if (!bound) return "No bound"
  return new Date(bound).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
}
