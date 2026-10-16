/**
 * Match readiness (COMP-06, v2) — pure computation over a fixture row plus
 * optionally-known registration facts. A check is `blocking` when the match
 * should not proceed without it; `ready` is true when every blocking check
 * passes. Rules:
 *  - Date and venue are blocking; the fixture must be playable.
 *  - A scorer is strongly recommended but not blocking (emergency scoring by
 *    an owner is a supported flow). When the match requires official
 *    approval (`scorerApprovalRequired`), the assigned member's consent
 *    (`scorerApprovedAt`) is part of this check; legacy matches without the
 *    requirement keep passing on assignment alone.
 *  - The toss is blocking only once the match has moved past `scheduled`
 *    (status toss/live/innings_break imply the toss must exist).
 *  - Squads are checked for tournament fixtures when their declaration state
 *    is known; legacy competitions (unknown/absent) never fail on this.
 *  - A known non-approved team registration blocks tournament play, matching
 *    the canonical writer. Missing registrations retain the legacy policy.
 *  - An umpire listing is advisory only, and is satisfied by EITHER a free
 *    text listing (external officials) OR a member-bound assignment
 *    (umpire1Id/umpire2Id, COMP-06). When the member-umpire consent
 *    requirement is armed (`umpireApprovalRequired`, mirroring scorer
 *    approval), the assigned member's consent (`umpireApprovedAt`) is part
 *    of this check; a pending consent fails it even alongside free text.
 *    Free text and member slots can coexist; assigning a member never
 *    rewrites external listings.
 */
export type MatchReadinessInput = {
  status: string | null
  scheduledDate: Date | null
  venueId: string | null
  tossWinnerId: string | null
  tossDecision: string | null
  scorerId: string | null
  backupScorerId?: string | null
  /** Official approval (COMP-06): consent state; absent/undefined = legacy match. */
  scorerApprovalRequired?: boolean
  scorerApprovedAt?: Date | string | null
  umpire1?: string | null
  /** Member-bound officials (COMP-06); satisfied alongside free-text listing. */
  umpire1Id?: string | null
  umpire2Id?: string | null
  /** Umpire consent state (mirrors scorer approval); absent/undefined = legacy. */
  umpireApprovalRequired?: boolean
  umpireApprovedAt?: Date | string | null
  tournamentId?: string | null
  teamASquadDeclared?: boolean
  teamBSquadDeclared?: boolean
  teamARegistrationApproved?: boolean
  teamBRegistrationApproved?: boolean
}

export type ReadinessCheck = {
  id: string
  label: string
  pass: boolean
  blocking: boolean
}

export function computeMatchReadiness(input: MatchReadinessInput): {
  ready: boolean
  checks: ReadinessCheck[]
} {
  const pastScheduling = input.status !== null && input.status !== "scheduled"
  const checks: ReadinessCheck[] = [
    {
      id: "schedule",
      label: "Fixture date and time set",
      pass: input.scheduledDate !== null,
      blocking: true,
    },
    {
      id: "venue",
      label: "Venue assigned",
      pass: input.venueId !== null,
      blocking: true,
    },
    {
      id: "scorer",
      label: input.scorerApprovalRequired ? "Scorer assigned and approved" : "Scorer assigned",
      pass: (input.scorerId !== null || input.backupScorerId !== null && input.backupScorerId !== undefined)
        // With the requirement armed, consent binds to the exact assignment.
        && (!input.scorerApprovalRequired || input.scorerApprovedAt !== null && input.scorerApprovedAt !== undefined),
      blocking: false,
    },
    {
      id: "toss",
      label: "Toss recorded",
      pass: input.tossWinnerId !== null && input.tossDecision !== null,
      blocking: pastScheduling,
    },
    {
      id: "officials",
      label: input.umpireApprovalRequired ? "Member umpire assigned and approved" : "Umpire listed or assigned",
      // A member assignment with a pending consent fails even when a free-text
      // listing exists - the consent question stays visible in readiness.
      pass: input.umpireApprovalRequired
        ? input.umpireApprovedAt !== null && input.umpireApprovedAt !== undefined
          && (input.umpire1Id !== null && input.umpire1Id !== undefined || input.umpire2Id !== null && input.umpire2Id !== undefined)
        : (input.umpire1 !== null && input.umpire1 !== "")
          || input.umpire1Id !== null && input.umpire1Id !== undefined
          || input.umpire2Id !== null && input.umpire2Id !== undefined,
      blocking: false,
    },
  ]

  if (input.tournamentId) {
    checks.push({
      id: "squads",
      label: "Squads declared at approval",
      // Unknown declaration state (legacy tournament) never blocks.
      pass: (input.teamASquadDeclared ?? true) && (input.teamBSquadDeclared ?? true),
      blocking: false,
    })
    checks.push({
      id: "registration",
      label: "Known team registrations approved",
      pass: (input.teamARegistrationApproved ?? true) && (input.teamBRegistrationApproved ?? true),
      blocking: true,
    })
  }

  return { ready: checks.every(check => check.pass || !check.blocking), checks }
}
