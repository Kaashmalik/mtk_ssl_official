/**
 * Squad eligibility (COMP-06, rule v1). Tournament squads are declared at
 * registration approval time (leagueRegistrations.squadPlayerIds). This pure
 * filter applies them to a team's scoring player list.
 *
 * Rule v1 — enforce only when an approved registration declares a NON-EMPTY
 * squad. Teams whose registration predates squads keep their full active
 * roster, and non-tournament (friendly/practice) matches are never filtered.
 * This keeps legacy competitions playable while new tournaments get true
 * squad enforcement. Note honestly: the delivery writers still accept any
 * tenant player id; enforcement here is at selection-time (the scoring
 * player list), which is the surface scorers actually use.
 */
export function applySquadEligibility<T extends { id: string }>(
  players: T[],
  squadPlayerIds: string[] | null | undefined,
): T[] {
  if (!squadPlayerIds || squadPlayerIds.length === 0) return players
  const allowed = new Set(squadPlayerIds)
  return players.filter(player => allowed.has(player.id))
}
