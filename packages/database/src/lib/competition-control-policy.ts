/**
 * COMP-07 (Batch 153): competition control as PURE POLICY. Forfeits,
 * postponements and rescheduling are OWNER decisions with a fixed
 * vocabulary and a named reason. Nothing here reads or writes; the writer
 * consumes these tables. A match can only be forfeited or postponed from
 * a live-or-scheduled state; completed/cancelled/abandoned/no_result are
 * terminal and cannot be rewritten into a forfeit after the fact (an
 * audited legacy correction is the only path, and it is not this one).
 */

export const FORFEITABLE_STATUSES = ["scheduled", "toss", "live", "innings_break"] as const
export const POSTPONABLE_STATUSES = ["scheduled", "toss", "live", "innings_break"] as const
export const RESCHEDULABLE_STATUSES = ["scheduled", "postponed"] as const

export function canForfeit(status: string): boolean {
  return (FORFEITABLE_STATUSES as readonly string[]).includes(status)
}

export function canPostpone(status: string): boolean {
  return (POSTPONABLE_STATUSES as readonly string[]).includes(status)
}

export function canReschedule(status: string): boolean {
  return (RESCHEDULABLE_STATUSES as readonly string[]).includes(status)
}

export function describeMatchControl(status: string): string {
  if (status === "forfeited") return "Forfeited. The result stands as recorded."
  if (status === "postponed") return "Postponed. A new date must be set before play resumes."
  if (status === "cancelled") return "Cancelled. No result will be recorded."
  if (status === "abandoned") return "Abandoned. No result will be recorded."
  if (status === "no_result") return "No result. The fixture produced no decision."
  return "Live competition. Reschedule or forfeit only while it is still open."
}
