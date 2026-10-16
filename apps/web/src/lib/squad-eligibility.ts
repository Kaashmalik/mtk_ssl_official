import { registrationAllowsPlayer, type SquadRegistration } from "@mtk/database/lib/registered-squad-eligibility"

/** Legacy declared-ID filter; full registration eligibility is shared with scoring-service below. */
export function applySquadEligibility<T extends { id: string }>(
  players: T[],
  squadPlayerIds: string[] | null | undefined,
): T[] {
  if (!squadPlayerIds || squadPlayerIds.length === 0) return players
  const allowed = new Set(squadPlayerIds)
  return players.filter(player => allowed.has(player.id))
}

/** Same v2 rule as canonical writes, including non-approved registration denial. */
export function applyRegistrationEligibility<T extends { id: string }>(players: T[], registration: SquadRegistration | undefined): T[] {
  if (!registration) return players
  return players.filter(player => registrationAllowsPlayer(registration, player.id))
}
