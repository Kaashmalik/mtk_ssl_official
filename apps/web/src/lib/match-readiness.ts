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
 *  - Declared XIs (COMP-06 slice): while `xiRequired` is armed, official
 *    approval (`xiApprovedAt`) is blocking — the canonical boundary refuses
 *    deliveries. For legacy/unarmed tournament fixtures the XI stays a
 *    non-blocking recommendation, matching the legacy-safe migration default.
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
  /**
   * Declared-XI gate (COMP-06 slice): armed only by an XI declaration write.
   * While armed, both sides must be officially approved before play; absent/
   * undefined or false = legacy match, which keeps XI purely recommended.
   */
  xiRequired?: boolean
  xiApprovedAt?: Date | string | null
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
    if (input.xiRequired) {
      checks.push({
        id: "playing-xi",
        label: "Playing XIs declared and approved",
        // Blocked while approval is pending - the canonical boundary refuses
        // deliveries for an armed match until an official approves both XIs.
        pass: input.xiApprovedAt !== null && input.xiApprovedAt !== undefined,
        blocking: true,
      })
    } else {
      checks.push({
        id: "playing-xi",
        label: "Playing XIs declared (recommended)",
        pass: false,
        blocking: false,
      })
    }
  }

  return { ready: checks.every(check => check.pass || !check.blocking), checks }
}
