/**
 * Fixture rescheduling checks (COMP-07) — pure, database-free. Rule v1:
 * a proposed start must keep `minRestHours` of separation from every other
 * uncancelled fixture of either participating team, and from any other use
 * of the same venue. Threshold-based rather than duration-based because
 * matches carry no duration column; the rule and threshold are recorded in
 * every reschedule audit payload so they are reviewable.
 */

export const DEFAULT_MIN_REST_HOURS = 4

export type ScheduledFixtureRef = {
  matchId: string
  teamAId: string
  teamBId: string
  venueId: string | null
  scheduledDate: Date | null
  status: string | null
}

export type SchedulingConflict = {
  conflictingMatchId: string
  reason: "team_rest" | "venue_in_use"
}

export function findSchedulingConflicts(input: {
  /** The fixture being rescheduled; it is never in conflict with itself. */
  targetMatchId: string
  teamAId: string
  teamBId: string
  venueId: string | null
  proposedStart: Date
  fixtures: ScheduledFixtureRef[]
  minRestHours?: number
}): SchedulingConflict[] {
  const {
    targetMatchId, teamAId, teamBId, venueId, proposedStart, fixtures,
    minRestHours = DEFAULT_MIN_REST_HOURS,
  } = input
  if (minRestHours < 0) throw new Error("Rest threshold cannot be negative")
  const restMs = minRestHours * 3_600_000
  const conflicts: SchedulingConflict[] = []

  for (const fixture of fixtures) {
    if (fixture.matchId === targetMatchId) continue
    if (fixture.status === "cancelled") continue
    if (!fixture.scheduledDate) continue
    const gap = Math.abs(fixture.scheduledDate.getTime() - proposedStart.getTime())
    if (gap >= restMs) continue

    const involvesTeam = fixture.teamAId === teamAId || fixture.teamAId === teamBId
      || fixture.teamBId === teamAId || fixture.teamBId === teamBId
    if (involvesTeam) {
      conflicts.push({ conflictingMatchId: fixture.matchId, reason: "team_rest" })
      continue
    }
    if (venueId && fixture.venueId === venueId) {
      conflicts.push({ conflictingMatchId: fixture.matchId, reason: "venue_in_use" })
    }
  }

  return conflicts
}
