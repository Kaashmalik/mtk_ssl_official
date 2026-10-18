/**
 * REG-03 (Batch 147): the tournament-application state machine as a pure
 * policy. Every transition between states is honest: only moves the TABLE
 * documents exist, each named by WHO is allowed to make it (member or
 * owner), terminal states are terminal, and a decision vocabulary is FIXED
 * - the reviewer's intent maps onto exactly one target state, never free
 * text. Nothing here reads or writes; the writer consumes these tables.
 */

export const APPLICATION_LIVE_STATES = ["submitted", "needs_information", "waitlisted"] as const
export const APPLICATION_TERMINAL_STATES = ["approved", "declined", "withdrawn"] as const
export type ApplicationLiveState = (typeof APPLICATION_LIVE_STATES)[number]
export type ApplicationTerminalState = (typeof APPLICATION_TERMINAL_STATES)[number]
export type ApplicationState = ApplicationLiveState | ApplicationTerminalState

export function isLiveStatus(status: string): status is ApplicationLiveState {
  return (APPLICATION_LIVE_STATES as readonly string[]).includes(status)
}

export function isTerminalStatus(status: string): status is ApplicationTerminalState {
  return (APPLICATION_TERMINAL_STATES as readonly string[]).includes(status)
}

/** The owner's decision vocabulary - each decision maps to one exact state. */
export const OWNER_DECISIONS = {
  approve: "approved",
  request_information: "needs_information",
  waitlist: "waitlisted",
  decline: "declined",
} as const satisfies Record<string, ApplicationState>

export type OwnerDecision = keyof typeof OWNER_DECISIONS

export function resolveOwnerDecision(decision: string): ApplicationState | null {
  return (OWNER_DECISIONS as Record<string, ApplicationState>)[decision] ?? null
}

/**
 * Member moves: only the TEAM'S manager may act, only on a LIVE
 * application, and the only member move is withdrawal (an honest exit,
 * never a self-approval). Returning null means "this move does not
 * exist" - the writer refuses rather than improvising.
 */
export function memberMove(current: string, action: "withdraw"): "withdrawn" | null {
  if (action !== "withdraw") return null
  return isLiveStatus(current) ? "withdrawn" : null
}

/**
 * Owner moves: any OWNER decision on a LIVE application. A decision on a
 * terminal application does not exist (no re-deciding history) - null.
 */
export function ownerMove(current: string, decision: OwnerDecision): ApplicationState | null {
  if (!isLiveStatus(current)) return null
  return resolveOwnerDecision(decision)
}

/** On resubmission after needs_information: allowed from any terminal-free spot? NO - a resubmission is a NEW row; the old one must be withdrawn first (the unique index permits exactly one live row). */
export function canResubmit(currentStatus: string): boolean {
  return isTerminalStatus(currentStatus)
}

/**
 * The member-facing sentence for a status: facts only, no promises. The
 * needs_information sentence states the documented default answer path.
 */
export function describeApplicationStatus(status: ApplicationState): string {
  switch (status) {
    case "submitted":
      return "Application submitted. The tournament owner will review it."
    case "needs_information":
      return "The owner requested more information. Withdraw and resubmit with the missing details."
    case "waitlisted":
      return "Waitlisted. If a slot opens, the owner decides from this list."
    case "approved":
      return "Application approved. Register your squad for the tournament."
    case "declined":
      return "Application declined. You may not resubmit for this tournament."
    case "withdrawn":
      return "Withdrawn. You can submit a new application for this tournament."
  }
}
