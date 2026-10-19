import { z } from "zod"

/**
 * REG-03 (Batch 164): the pure reply policy for tournament-application
 * threads. Replies are a RECORD conversation attached to a LIVE
 * application; authority (who may speak, and on which side) is verified
 * server-side by the writer — this policy owns the vocabulary, the body
 * discipline and the thread-lock rules so both never drift.
 */

export const REPLY_AUTHOR_SIDES = ["member", "owner"] as const
export type ReplyAuthorSide = (typeof REPLY_AUTHOR_SIDES)[number]

export const REPLY_BODY_MAX = 2000
export const REPLIES_PER_APPLICATION_LIMIT = 50

/**
 * Body discipline mirrors the B142 display-name rule: trim + whitespace
 * collapse, hard cap REFUSED with a reason (never silently truncated),
 * empty = explicit refusal (a blank reply is not a message).
 */
export function normalizeReplyBody(raw: string): { body: string } | { refusal: "empty_body" | "body_too_long" } {
  const collapsed = raw.trim().replace(/\s+/g, " ")
  if (collapsed.length === 0) return { refusal: "empty_body" }
  if (collapsed.length > REPLY_BODY_MAX) return { refusal: "body_too_long" }
  return { body: collapsed }
}

/**
 * Who may speak, derived from verified facts (never from the client).
 * The thread's two voices only:
 * - member: the manager of the team that applied (a live application's
 *   team manager may come and go — the CURRENT manager speaks for the team);
 * - owner: a league_owner of the application's league.
 * Anything else (scorer, captain, other-league members, service
 * identities) is a refusal by construction.
 */
export function replyAuthorSide(
  viewer: { userId: string },
  application: { teamManagerId: string; tenantId: string },
  membership: { role: string; status: string } | null,
): ReplyAuthorSide | null {
  if (viewer.userId === application.teamManagerId) return "member"
  if (membership && membership.status === "active" && membership.role === "league_owner") return "owner"
  return null
}

/**
 * Threads live only on LIVE applications. A terminal application's history
 * stays readable (it is the audit trail of the conversation), but never
 * extended: approving/declining ends the discussion, deliberately.
 */
export function replyThreadTarget(currentStatus: string): "open" | "terminal" {
  return ["submitted", "needs_information", "waitlisted"].includes(currentStatus) ? "open" : "terminal"
}

export function describeReplyRefusal(refusal: "empty_body" | "body_too_long" | "terminal" | "forbidden" | "flood"): string {
  switch (refusal) {
    case "empty_body": return "Write a message before sending."
    case "body_too_long": return `Keep messages to ${REPLY_BODY_MAX} characters.`
    case "terminal": return "This application has been resolved, so its conversation is locked."
    case "forbidden": return "Only the team's manager or the league owner can join this conversation."
    case "flood": return `This conversation has reached its limit of ${REPLIES_PER_APPLICATION_LIMIT} messages.`
  }
}

/** Transport schema shared with the action tier (the policy stays authority). */
export const replyInputSchema = z.object({
  applicationId: z.string().uuid(),
  body: z.string().min(1).max(REPLY_BODY_MAX + 100),
})
