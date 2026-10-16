/**
 * Declared-squad eligibility v2, shared by selectors and the canonical writer.
 * No registration / approved null-or-empty squads preserve legacy roster rules.
 * An existing non-approved registration never restores unrestricted eligibility.
 * This is not an immutable playing XI, substitution or participation-history model.
 */
export interface SquadRegistration {
  tenantId: string
  tournamentId: string
  teamId: string
  status: string
  squadPlayerIds: string[] | null
}

export function registrationAllowsPlayer(
  registration: Pick<SquadRegistration, "status" | "squadPlayerIds"> | undefined,
  playerId: string,
): boolean {
  if (!registration) return true
  if (registration.status !== "approved") return false
  return !registration.squadPlayerIds?.length || registration.squadPlayerIds.includes(playerId)
}

/** Reject duplicate or mis-scoped data instead of choosing an arbitrary squad. */
export function matchRegistrationMap(
  rows: SquadRegistration[], tenantId: string, tournamentId: string, teamIds: readonly string[],
): Map<string, SquadRegistration> {
  const sides = new Set(teamIds)
  const map = new Map<string, SquadRegistration>()
  if (sides.size !== 2 || rows.length > 2) throw new Error("Tournament registrations require review")
  for (const row of rows) {
    if (row.tenantId !== tenantId || row.tournamentId !== tournamentId || !sides.has(row.teamId) || map.has(row.teamId)) {
      throw new Error("Tournament registrations require review")
    }
    map.set(row.teamId, row)
  }
  return map
}
