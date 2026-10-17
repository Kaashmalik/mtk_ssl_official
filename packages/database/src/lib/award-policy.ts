/**
 * PUB-04 official-award policy (pure, shared).
 *
 * The single source of truth for which categories exist, their display labels,
 * and when an award row may appear on the public tournament gallery. Official
 * awards are organizer-declared; fan favorites and AI suggestions never count
 * as, or rank against, an official award — that separation is PUB-04's core
 * requirement, so the writer stores only organizer decisions here.
 */

export const AWARD_CATEGORIES = [
  "player_of_the_tournament",
  "best_batsman",
  "best_bowler",
  "best_all_rounder",
  "best_fielder",
  "best_wicketkeeper",
  "emerging_player",
  "fair_play",
] as const

export type AwardCategory = (typeof AWARD_CATEGORIES)[number]

export const AWARD_CATEGORY_LABELS: Record<AwardCategory, string> = {
  player_of_the_tournament: "Player of the Tournament",
  best_batsman: "Best Batsman",
  best_bowler: "Best Bowler",
  best_all_rounder: "Best All-Rounder",
  best_fielder: "Best Fielder",
  best_wicketkeeper: "Best Wicketkeeper",
  emerging_player: "Emerging Player",
  fair_play: "Fair Play",
}

export function isAwardCategory(value: unknown): value is AwardCategory {
  return typeof value === "string" && (AWARD_CATEGORIES as readonly string[]).includes(value)
}

export type AwardVisibilityRow = {
  supersededAt?: Date | string | null
  playerId?: string | null
  teamId?: string | null
}

/**
 * Visible in the public gallery: an ACTIVE (never superseded) award row with a
 * resolvable single winner, shown only for a tournament the publication policy
 * already admits (the caller must apply `isTournamentPublished`). Anything
 * ambiguous — a deleted winner reference leaving no winner — fails closed.
 */
export function isAwardVisible(
  row: AwardVisibilityRow | null | undefined,
  tournamentPublished: boolean,
): boolean {
  if (!row || !tournamentPublished) return false
  if (row.supersededAt != null) return false
  return (row.playerId != null) !== (row.teamId != null)
}

/** Bounded gallery size; the page discloses incompleteness beyond this. */
export const PUBLIC_AWARD_LIMIT = 20
