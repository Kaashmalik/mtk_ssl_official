import { and, eq, asc, desc, inArray, sum } from "drizzle-orm"
import { db, matches, tournaments, teams, matchInnings, players, playerSeasonStats } from "@mtk/database"

/**
 * Publication boundary for the public (unauthenticated) surface.
 *
 * `/matches/[id]`, `/matches/[id]/live`, `/tournaments/[id]`, the scorecard PDF
 * export and `/leaderboards` are reachable without a session. They are already
 * tenant-scoped to the request host (see `lib/public-tenant.ts`), but a tenant
 * scope alone is not a publication decision: an organizer's unannounced `draft`
 * tournament and a `cancelled` fixture were still readable by anyone on the
 * league's host.
 *
 * These pure predicates derive publication from the existing lifecycle columns
 * (no new schema) and are the single source of truth for "is this safe to show
 * to the public?". They are deliberately conservative: anything ambiguous is
 * hidden, and the database stays authoritative.
 */

/** Tournament statuses that may be shown to the public. `draft`/`cancelled` may not. */
export const PUBLISHED_TOURNAMENT_STATUS_VALUES = ["registration", "live", "completed"] as const

/** Match statuses that may be shown to the public. A cancelled fixture may not. */
export const PUBLISHED_MATCH_STATUS_VALUES = [
  "scheduled", "toss", "live", "innings_break", "completed", "abandoned", "no_result",
] as const

const PUBLISHED_TOURNAMENT_STATUSES: ReadonlySet<string> = new Set(PUBLISHED_TOURNAMENT_STATUS_VALUES)
const PUBLISHED_MATCH_STATUSES: ReadonlySet<string> = new Set(PUBLISHED_MATCH_STATUS_VALUES)

/** Public leaderboard rows are bounded, newest-agnostic (ranked by aggregate). */
export const PUBLIC_LEADERBOARD_LIMIT = 10

export function isTournamentPublished(status: string | null | undefined): boolean {
  return !!status && PUBLISHED_TOURNAMENT_STATUSES.has(status)
}

export function isMatchPublished(status: string | null | undefined): boolean {
  return !!status && PUBLISHED_MATCH_STATUSES.has(status)
}

export type PublicTournament = typeof tournaments.$inferSelect
export type PublicMatch = typeof matches.$inferSelect

/**
 * Reads a single tournament scoped to the tenant AND gated on publication. A
 * draft/cancelled tournament resolves to `null`, so the caller 404s exactly as
 * it would for a foreign or missing id (no signal that the row exists).
 */
export async function readPublishedTournament(tenantId: string, id: string): Promise<PublicTournament | null> {
  const [row] = await db.select().from(tournaments)
    .where(and(eq(tournaments.id, id), eq(tournaments.tenantId, tenantId)))
    .limit(1)
  if (!row || !isTournamentPublished(row.status)) return null
  return row
}

/**
 * Reads a single match scoped to the tenant and gated on publication. A match
 * is hidden when it is cancelled, or when it belongs to a tournament that is
 * itself unpublished — a fixture cannot be public while its competition is a
 * draft. Matches without a tournament (friendlies) are governed by their own
 * status alone.
 */
export async function readPublishedMatch(tenantId: string, id: string): Promise<PublicMatch | null> {
  const [row] = await db.select().from(matches)
    .where(and(eq(matches.id, id), eq(matches.tenantId, tenantId)))
    .limit(1)
  if (!row || !isMatchPublished(row.status)) return null

  if (row.tournamentId) {
    const [parent] = await db.select({ status: tournaments.status }).from(tournaments)
      .where(and(eq(tournaments.id, row.tournamentId), eq(tournaments.tenantId, tenantId)))
      .limit(1)
    // A missing parent means a broken/foreign reference — fail closed.
    if (!parent || !isTournamentPublished(parent.status)) return null
  }
  return row
}

/** Same-league team name lookup used by the public match/live pages. */
export async function readPublishedMatchTeams(tenantId: string, match: PublicMatch) {
  const [teamA] = await db.select().from(teams)
    .where(and(eq(teams.id, match.teamAId), eq(teams.tenantId, tenantId))).limit(1)
  const [teamB] = await db.select().from(teams)
    .where(and(eq(teams.id, match.teamBId), eq(teams.tenantId, tenantId))).limit(1)
  return { teamA: teamA ?? null, teamB: teamB ?? null }
}

/** True when a same-league match has any scored innings (used to decide emptiness). */
export async function matchHasInnings(tenantId: string, matchId: string): Promise<boolean> {
  const [row] = await db.select({ id: matchInnings.id }).from(matchInnings)
    .where(and(eq(matchInnings.matchId, matchId), eq(matchInnings.tenantId, tenantId))).limit(1)
  return !!row
}

export type PublicLeaderboardRow = { playerId: string; playerName: string; total: number }

/**
 * Public batting/bowling leaderboard for one tenant.
 *
 * Every read is pinned to the active league and joined to a *published*
 * tournament, so season stats still attached to a draft/cancelled competition
 * are never published, and no other league's players can appear. Results are
 * bounded and deterministically ordered (ties break on playerId).
 */
async function readPublicLeaderboard(
  tenantId: string,
  metric: "runs" | "wickets",
): Promise<PublicLeaderboardRow[]> {
  const column = metric === "runs" ? playerSeasonStats.runsScored : playerSeasonStats.wicketsTaken
  const rows = await db
    .select({
      playerId: playerSeasonStats.playerId,
      playerName: players.name,
      total: sum(column).mapWith(Number),
    })
    .from(playerSeasonStats)
    .innerJoin(
      players,
      and(eq(players.id, playerSeasonStats.playerId), eq(players.tenantId, tenantId)),
    )
    .innerJoin(
      tournaments,
      and(eq(tournaments.id, playerSeasonStats.tournamentId), eq(tournaments.tenantId, tenantId)),
    )
    .where(and(
      eq(playerSeasonStats.tenantId, tenantId),
      inArray(tournaments.status, [...PUBLISHED_TOURNAMENT_STATUS_VALUES]),
    ))
    .groupBy(playerSeasonStats.playerId, players.name)
    .orderBy(desc(sum(column)), asc(playerSeasonStats.playerId))
    .limit(PUBLIC_LEADERBOARD_LIMIT)
  return rows
}

/** Batting leaderboard for the public hub, scoped and publication-gated. */
export function readPublicBattingLeaderboard(tenantId: string) {
  return readPublicLeaderboard(tenantId, "runs")
}

/** Bowling leaderboard for the public hub, scoped and publication-gated. */
export function readPublicBowlingLeaderboard(tenantId: string) {
  return readPublicLeaderboard(tenantId, "wickets")
}
