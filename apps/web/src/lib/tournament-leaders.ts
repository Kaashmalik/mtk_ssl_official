import type { PublicLeaderboardRow } from "@/lib/public-visibility"

/**
 * Batch 124: "Most Runs / Most Wickets" on the public tournament page.
 * The rows come from the SAME gated reads the public leaderboards page uses
 * (in-tenant join, published-tournament filter, minor-consent gate), scoped
 * to this one competition. The builder invents nothing: only complete rows
 * are admitted, each list is capped, ranks are 1-based sequential, verified
 * flags pass through unchanged, and a tournament with no published stats
 * yields null — the page renders no card at all, never an empty shell.
 */

export const TOURNAMENT_LEADERS_LIMIT = 5

export type TournamentLeaderRow = {
  rank: number
  playerId: string
  playerName: string
  playerVerified: boolean
  total: number
}

export type TournamentLeadersData = {
  batting: TournamentLeaderRow[]
  bowling: TournamentLeaderRow[]
}

function admit(rows: PublicLeaderboardRow[] | null | undefined): TournamentLeaderRow[] {
  return (rows ?? [])
    .filter(
      (r): r is PublicLeaderboardRow =>
        typeof r?.playerName === "string" &&
        r.playerName.trim().length > 0 &&
        typeof r?.total === "number" &&
        Number.isFinite(r.total),
    )
    .slice(0, TOURNAMENT_LEADERS_LIMIT)
    .map((r, index) => ({
      rank: index + 1,
      playerId: r.playerId,
      playerName: r.playerName,
      playerVerified: r.playerVerified === true,
      total: r.total,
    }))
}

export function buildTournamentLeaders(input: {
  batting: PublicLeaderboardRow[] | null | undefined
  bowling: PublicLeaderboardRow[] | null | undefined
}): TournamentLeadersData | null {
  const batting = admit(input.batting)
  const bowling = admit(input.bowling)
  if (batting.length === 0 && bowling.length === 0) return null
  return { batting, bowling }
}
