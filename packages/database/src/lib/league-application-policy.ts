/**
 * Platform league-application policy (REG-01).
 *
 * Pure, shared, fail-closed vocabulary for the league-application lifecycle
 * ("Sign up -> create league application -> platform review -> activate
 * workspace"). The applicant-facing writers and the platform review route both
 * consult these functions, so the two sides cannot drift.
 *
 * Everything fails closed: unknown states/actions refuse, terminal states
 * never transition, and provisioning is refused on any ambiguity (missing or
 * deactivated applicant, an applicant who already owns a league, or an
 * application that was already provisioned).
 */

/** Full lifecycle. `approved`, `rejected` and `withdrawn` are terminal. */
export const LEAGUE_APPLICATION_STATES = [
  "draft",
  "submitted",
  "needs_information",
  "approved",
  "rejected",
  "withdrawn",
] as const
export type LeagueApplicationState = (typeof LEAGUE_APPLICATION_STATES)[number]

/**
 * States that occupy the applicant's single active application slot. A partial
 * unique index enforces at most one of these per applicant, so a rejected or
 * withdrawn application never blocks a fresh one.
 */
export const LEAGUE_APPLICATION_ACTIVE_STATES = ["draft", "submitted", "needs_information"] as const

/** Every reviewed applicant/platform action on an application. */
export const LEAGUE_APPLICATION_ACTIONS = [
  "submit",
  "withdraw",
  "request_information",
  "reject",
  "approve",
] as const
export type LeagueApplicationAction = (typeof LEAGUE_APPLICATION_ACTIONS)[number]

const stateSet: ReadonlySet<string> = new Set(LEAGUE_APPLICATION_STATES)
const actionSet: ReadonlySet<string> = new Set(LEAGUE_APPLICATION_ACTIONS)
const activeStateSet: ReadonlySet<string> = new Set(LEAGUE_APPLICATION_ACTIVE_STATES)

export function isLeagueApplicationState(value: unknown): value is LeagueApplicationState {
  return typeof value === "string" && stateSet.has(value)
}

export function isLeagueApplicationAction(value: unknown): value is LeagueApplicationAction {
  return typeof value === "string" && actionSet.has(value)
}

export function isLeagueApplicationActiveState(value: unknown): boolean {
  return typeof value === "string" && activeStateSet.has(value)
}

export type LeagueApplicationTransition =
  | { outcome: "allowed"; nextState: LeagueApplicationState; requiresReason: boolean }
  | { outcome: "refused"; code: "unknown-state" | "unknown-action" | "illegal-transition" }

/**
 * The single transition table. `request_information` and `reject` are the only
 * actions that carry a mandatory reviewer reason; `submit` doubles as the
 * resubmission after `needs_information` (the form fields may change and the
 * previous review reason is cleared by the writer).
 */
export function leagueApplicationTransition(state: string, action: string): LeagueApplicationTransition {
  if (!isLeagueApplicationState(state)) return { outcome: "refused", code: "unknown-state" }
  if (!isLeagueApplicationAction(action)) return { outcome: "refused", code: "unknown-action" }

  if (action === "submit") {
    if (state === "draft" || state === "needs_information") {
      return { outcome: "allowed", nextState: "submitted", requiresReason: false }
    }
    return { outcome: "refused", code: "illegal-transition" }
  }

  if (action === "withdraw") {
    if (isLeagueApplicationActiveState(state)) {
      return { outcome: "allowed", nextState: "withdrawn", requiresReason: false }
    }
    return { outcome: "refused", code: "illegal-transition" }
  }

  if (action === "request_information") {
    if (state === "submitted") {
      return { outcome: "allowed", nextState: "needs_information", requiresReason: true }
    }
    return { outcome: "refused", code: "illegal-transition" }
  }

  if (action === "reject") {
    // A reviewer may reject while the applicant is mid-answer as well: waiting
    // for information the platform already knows disqualifies the application
    // would be busywork.
    if (state === "submitted" || state === "needs_information") {
      return { outcome: "allowed", nextState: "rejected", requiresReason: true }
    }
    return { outcome: "refused", code: "illegal-transition" }
  }

  // Only `approve` remains.
  if (state === "submitted") {
    return { outcome: "allowed", nextState: "approved", requiresReason: false }
  }
  return { outcome: "refused", code: "illegal-transition" }
}

export type LeagueApplicationProvisioningDecision =
  | { outcome: "provision" }
  | {
      outcome: "refused"
      code:
        | "not-submitted"
        | "already-provisioned"
        | "applicant-missing"
        | "applicant-inactive"
        | "already-owns-league"
    }

/**
 * The approval-time provisioning gate. Approval and workspace creation are one
 * atomic decision: an application may provision a league only when it is
 * `submitted` (the transition that reaches the approval), was never provisioned
 * before, and its applicant is an active account that still owns no league.
 * The one-owned-league cap is re-verified here because the applicant may have
 * created a league through self-service while the application was pending.
 */
export function leagueApplicationProvisioningDecision(input: {
  state: string
  provisionedTenantId: string | null | undefined
  applicant: { isActive: boolean } | null | undefined
  ownedTenant: { id: string } | null | undefined
}): LeagueApplicationProvisioningDecision {
  if (input.state !== "submitted") return { outcome: "refused", code: "not-submitted" }
  if (input.provisionedTenantId != null) return { outcome: "refused", code: "already-provisioned" }
  if (!input.applicant) return { outcome: "refused", code: "applicant-missing" }
  if (input.applicant.isActive !== true) return { outcome: "refused", code: "applicant-inactive" }
  if (input.ownedTenant != null) return { outcome: "refused", code: "already-owns-league" }
  return { outcome: "provision" }
}

/**
 * ENH-02-02: persisted applicant replies under an information request.
 * Deliberately a separate surface from the tournament-application reply
 * policy (REG-03): league onboarding is platform-level (no tenant), the only
 * author side is the applicant, and the thread opens ONLY while a reviewer
 * has explicitly requested information — not on a merely-live application.
 * Replies are additive records and never mutate the state machine.
 */

export const LEAGUE_REPLY_BODY_MAX = 2000

export const LEAGUE_APPLICATION_REPLY_AUTHOR_SIDES = ["applicant"] as const
export type LeagueApplicationReplyAuthorSide = (typeof LEAGUE_APPLICATION_REPLY_AUTHOR_SIDES)[number]

export type LeagueReplyRefusal = "empty_body" | "body_too_long" | "terminal" | "not_requested"

export function normalizeLeagueReplyBody(raw: string): { body: string } | { refusal: "empty_body" | "body_too_long" } {
  const body = raw.replace(/\s+/g, " ").trim()
  if (!body) return { refusal: "empty_body" }
  if (body.length > LEAGUE_REPLY_BODY_MAX) return { refusal: "body_too_long" }
  return { body }
}

export function describeLeagueReplyRefusal(refusal: LeagueReplyRefusal): string {
  switch (refusal) {
    case "empty_body":
      return "Write a message before posting your reply."
    case "body_too_long":
      return `Keep replies within ${LEAGUE_REPLY_BODY_MAX} characters.`
    case "terminal":
      return "This application is decided; its thread is read only."
    case "not_requested":
      return "The platform has not requested information on this application, so there is nothing to answer yet."
  }
}

export type LeagueApplicationReplyTarget = "open" | "terminal" | "not_requested"

/** Which kind of surface an application state presents to a would-be replier. */
export function leagueApplicationReplyTarget(state: string): LeagueApplicationReplyTarget {
  if (state === "needs_information") return "open"
  if (!isLeagueApplicationState(state)) return "not_requested"
  if (isLeagueApplicationActiveState(state)) return "not_requested"
  return "terminal"
}
