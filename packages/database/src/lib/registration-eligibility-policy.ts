/**
 * REG-04 (Batch 148): registration approval, fee status and squad
 * eligibility as PURE POLICY. The schema already carries status,
 * payment_status, squad_player_ids, approved_by, approved_at. What this
 * adds is the HONEST eligibility decision: approval, payment and a
 * filled squad are SEPARATE gates and every one of them is named in the
 * refusal list so a manager is never told "ineligible" without a reason.
 * No invented eligibility: a team is eligible only when (a) approved,
 * (b) paid or waived, (c) squad size >= the tournament's minimum, and
 * (d) the registration and the team are in the SAME league (cross-tenant
 * resources are never bound together, even by an owner).
 */

export type RegistrationApprovalStatus = "pending" | "approved" | "rejected" | "withdrawn" | "waitlisted"
export type RegistrationPaymentStatus = "unpaid" | "paid" | "refunded" | "waived"

export interface EligibilityInput {
  approvalStatus: string
  paymentStatus: string
  squadSize: number
  minSquadSize: number
}

export interface EligibilityResult {
  eligible: boolean
  blockers: string[]
}

export function evaluateSquadEligibility(input: EligibilityInput): EligibilityResult {
  const blockers: string[] = []
  if (input.approvalStatus !== "approved") {
    blockers.push("registration must be approved")
  }
  if (input.paymentStatus !== "paid" && input.paymentStatus !== "waived") {
    blockers.push("registration fee must be paid or waived")
  }
  if (!Number.isInteger(input.minSquadSize) || input.minSquadSize < 0) {
    blockers.push("tournament minimum squad size is not configured")
  }
  if (!Number.isInteger(input.squadSize) || input.squadSize < 0) {
    blockers.push("squad size is invalid")
  }
  if (
    Number.isInteger(input.minSquadSize) &&
    input.minSquadSize >= 0 &&
    Number.isInteger(input.squadSize) &&
    input.squadSize >= 0 &&
    input.squadSize < input.minSquadSize
  ) {
    blockers.push(`squad must have at least ${input.minSquadSize} players (currently ${input.squadSize})`)
  }
  return { eligible: blockers.length === 0, blockers }
}

/** Approval is a transition, not a re-assertion: only pending registrations may be approved. */
export function canApproveRegistration(status: string): boolean {
  return status === "pending" || status === "waitlisted"
}

/** Rejection is likewise a transition. */
export function canRejectRegistration(status: string): boolean {
  return status === "pending" || status === "waitlisted"
}

/**
 * ENH-05-03: a registered squad may be corrected while the entry still awaits
 * review — exactly the transition set as approval/rejection. An owner's or
 * manager's later edit can never rewrite history the review already saw.
 */
export function canEditRegistrationSquad(status: string): boolean {
  return status === "pending" || status === "waitlisted"
}

/** Payment state transitions: only forward, never silently refunding. */
export function canSetPaymentStatus(current: string, next: string): boolean {
  const allowed: Record<string, readonly string[]> = {
    unpaid: ["paid", "waived"],
    paid: ["refunded"],
    waived: ["refunded"],
    refunded: [],
  }
  return (allowed[current] ?? []).includes(next)
}

/**
 * ENH-05-03 slice 5: a withdrawal is the ENTRANT pulling out of its own
 * submission. It is possible while the entry still awaits review and after
 * approval (before play begins) — but never after rejection (the review
 * already answered) or from an already-terminal state.
 */
export function canWithdrawRegistrationEntry(status: string): boolean {
  return status === "pending" || status === "approved"
}

/** Related resources must share a tenant; cross-tenant bindings are refused outright. */
export function sameLeague(tournamentTenantId: string, teamTenantId: string): boolean {
  return tournamentTenantId !== "" && tournamentTenantId === teamTenantId
}

/** The member-facing sentence for an eligibility result. */
export function describeEligibility(result: EligibilityResult): string {
  return result.eligible
    ? "Squad is eligible for this tournament."
    : `Not eligible yet: ${result.blockers.join("; ")}.`
}
