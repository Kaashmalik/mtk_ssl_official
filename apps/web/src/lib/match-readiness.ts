/**
 * Match readiness (COMP-06, v2) — pure computation over a fixture row plus
 * optionally-known registration facts. A check is `blocking` when the match
 * should not proceed without it; `ready` is true when every blocking check
 * passes. Rules:
 *  - Date and venue are blocking; the fixture must be playable.
 *  - A scorer is strongly recommended but not blocking (emergency scoring by
 *    an owner is a supported flow).
 *  - The toss is blocking only once the match has moved past `scheduled`
 *    (status toss/live/innings_break imply the toss must exist).
 *  - Squads are checked for tournament fixtures when their declaration state
 *    is known; legacy competitions (unknown/absent) never fail on this.
 *  - A known non-approved team registration blocks tournament play, matching
 *    the canonical writer. Missing registrations retain the legacy policy.
 *  - An umpire listing is advisory only; formal official approval is a
 *    separate, still-open capability (schema needed).
 */
export type MatchReadinessInput = {
  status: string | null
  scheduledDate: Date | null
  venueId: string | null
  tossWinnerId: string | null
  tossDecision: string | null
  scorerId: string | null
  backupScorerId?: string | null
  umpire1?: string | null
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
      label: "Scorer assigned",
      pass: input.scorerId !== null || input.backupScorerId !== null && input.backupScorerId !== undefined,
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
      label: "Umpire listed",
      pass: input.umpire1 !== null && input.umpire1 !== "",
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
