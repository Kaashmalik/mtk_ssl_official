import { LEAGUE_APPLICATION_ACTIVE_STATES } from "@mtk/database/lib/league-application-policy"

/**
 * ENH-02-01 (fan-versus-organizer destination): an account with no active
 * league membership used to be funneled to the ORGANIZER setup form no matter
 * who they were. The landing now follows the account's own facts:
 *   - a live application journey returns to the application status surface;
 *   - everyone else gets the explore-or-organize hub (follow matches publicly
 *     vs. create an instant league vs. apply for reviewed onboarding), whose
 *     surface also links a TERMINAL previous application so a returning
 *     rejected/withdrawn applicant can read their decision.
 * No branch grants membership or any operational right.
 */

export type NoTenantLanding =
  | { kind: "application-status"; path: "/dashboard/league/apply" }
  | { kind: "explore-or-organize"; withPreviousApplication: boolean }

export function resolveNoTenantLanding(input: { applicationState: string | null }): NoTenantLanding {
  const { applicationState } = input
  if (
    applicationState &&
    (LEAGUE_APPLICATION_ACTIVE_STATES as readonly string[]).includes(applicationState)
  ) {
    return { kind: "application-status", path: "/dashboard/league/apply" }
  }
  // A terminal state still leaves a readable decision behind; an UNKNOWN
  // state is data drift and must not claim an application exists.
  const knownTerminal = ["approved", "rejected", "withdrawn"]
  return { kind: "explore-or-organize", withPreviousApplication: !!applicationState && knownTerminal.includes(applicationState) }
}
