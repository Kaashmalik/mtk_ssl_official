/**
 * Resource-scoped grant design (ISO-05) — the single source of truth for
 * authority that is bounded to ONE resource inside a league, as distinct from
 * (a) league-wide role permissions and (b) platform roles.
 *
 * THE MODEL
 *  - A role (`user_tenant_roles.role`) is a league-wide capability class.
 *    It states what KIND of thing the member may do ("manage a team",
 *    "score a match"); by itself it names no resource.
 *  - A resource grant is a durable, audited pointer on the resource row
 *    itself: `matches.scorer_id` / `matches.backup_scorer_id` for match
 *    scoring, `teams.manager_id` / `teams.captain_id` for team management.
 *    Grants are created and revoked only through each resource's locked,
 *    audited writer (scorer assignment, team-manager invite redemption), so
 *    no side table can drift from the resource it authorizes.
 *  - A decision is therefore composed: the role must permit the capability
 *    class, AND the actor must hold the resource grant (league owners hold
 *    every grant by scope, expressed per writer as an explicit role check so
 *    the audit shows who acted as owner vs as grantee).
 *  - Every decision composes with `membershipGrantsAccess` under the
 *    caller's row lock: a suspended or expired membership voids its grants
 *    no matter what pointers remain (SCORE-09). Grants never outlive the
 *    membership they were given to.
 *  - Platform roles are NOT league roles. `super_admin` never appears in a
 *    membership decision in this design; league surfaces deny it and it
 *    carries no resource grants.
 *
 * These pure functions derive WHICH grant an actor holds (or null); the
 * throwing/decision logic lives with each writer so messages and audits stay
 * identical across consumers (web app and scoring service share this module).
 */

/** Scoring slots are exclusive: a row holding both slots is corrupt data. */
export type ScorerSlotGrant = "primary" | "backup"

export function scorerSlotGrant(
  match: { scorerId: string | null; backupScorerId?: string | null },
  actorId: string,
): ScorerSlotGrant | null {
  if (match.scorerId === actorId) return "primary"
  if (match.backupScorerId === actorId) return "backup"
  return null
}

/** A team has at most one manager and one captain; either may manage it. */
export type TeamManagementGrant = "manager" | "captain"

export function teamManagementGrant(
  team: { managerId: string | null; captainId: string | null },
  actorId: string,
): TeamManagementGrant | null {
  if (team.managerId === actorId) return "manager"
  if (team.captainId === actorId) return "captain"
  return null
}

/** Platform (off-league) roles. They never hold league resource grants. */
export const PLATFORM_ROLES = ["super_admin"] as const

export function isPlatformRole(role: string): boolean {
  return (PLATFORM_ROLES as readonly string[]).includes(role)
}
