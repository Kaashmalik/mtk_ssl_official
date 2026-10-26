/**
 * Pure policy for two-person approval of destructive platform-admin actions.
 *
 * Route handlers resolve the actor from verified server identity
 * (`verifySuperAdmin`), never from request JSON, and pass it here. Every
 * decision is a plain value so the rules are testable without a database.
 */

export const ADMIN_APPROVAL_TTL_HOURS = 24
export const ADMIN_APPROVAL_MIN_REASON_LENGTH = 10
export const ADMIN_APPROVAL_MAX_REASON_LENGTH = 1000

export type AdminApprovalDecision = "approve" | "reject" | "cancel"

export interface PendingApprovalView {
  status: string
  requestedBy: string
  expiresAt: Date
}

export type ApprovalVerdict =
  | { ok: true; nextStatus: "executed" | "rejected" | "cancelled" }
  | { ok: false; status: 403 | 409 | 410; error: string }

export function approvalExpiry(now: Date): Date {
  return new Date(now.getTime() + ADMIN_APPROVAL_TTL_HOURS * 60 * 60 * 1000)
}

/** Returns the trimmed reason, or null when it is missing, too short or too long. */
export function normalizeApprovalReason(input: unknown): string | null {
  if (typeof input !== "string") return null
  const reason = input.trim()
  if (reason.length < ADMIN_APPROVAL_MIN_REASON_LENGTH) return null
  if (reason.length > ADMIN_APPROVAL_MAX_REASON_LENGTH) return null
  return reason
}

export function parseApprovalDecision(input: unknown): AdminApprovalDecision | null {
  return input === "approve" || input === "reject" || input === "cancel" ? input : null
}

/**
 * Decide whether `actorId` may apply `decision` to `request` at `now`.
 *
 * - Only a pending, unexpired request can be decided.
 * - Approve and reject require a second person: never the requester.
 * - Cancel is reserved for the requester (withdrawing their own request).
 */
export function evaluateApprovalDecision(
  request: PendingApprovalView,
  actorId: string,
  decision: AdminApprovalDecision,
  now: Date,
): ApprovalVerdict {
  if (request.status !== "pending") {
    return { ok: false, status: 409, error: `This request is already ${request.status}.` }
  }
  if (request.expiresAt.getTime() <= now.getTime()) {
    return { ok: false, status: 410, error: "This request has expired. Ask for the action again." }
  }

  const isRequester = request.requestedBy === actorId
  if (decision === "cancel") {
    return isRequester
      ? { ok: true, nextStatus: "cancelled" }
      : { ok: false, status: 403, error: "Only the admin who asked for this action can cancel it." }
  }
  if (isRequester) {
    return { ok: false, status: 403, error: "A second super admin must review this request. You cannot approve or reject your own request." }
  }
  return { ok: true, nextStatus: decision === "approve" ? "executed" : "rejected" }
}
