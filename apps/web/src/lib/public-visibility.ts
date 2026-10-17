import { and, asc, count, desc, eq, gte, inArray, sql, sum } from "drizzle-orm"
import { db, matches, tournaments, teams, matchInnings, players, users, playerSeasonStats, battingScorecards, bowlingScorecards, fieldingScorecards } from "@mtk/database"
import { publicLeaderboardFilters, type PublicLeaderboardFilterInput, type PublicLeaderboardFilters } from "./leaderboard-filters"
import { isVerifiedPlayerRecord } from "@mtk/database/lib/career-records"
import { isTournamentPublished, isMatchPublished, PUBLISHED_TOURNAMENT_STATUS_VALUES } from "@mtk/database/lib/publication-policy"
export { isTournamentPublished, isMatchPublished, PUBLISHED_TOURNAMENT_STATUS_VALUES, PUBLISHED_MATCH_STATUS_VALUES } from "@mtk/database/lib/publication-policy"

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

/** Public leaderboard rows are bounded, newest-agnostic (ranked by aggregate). */
export const PUBLIC_LEADERBOARD_LIMIT = 10

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

/**
 * A leaderboard row carries its verification provenance: `playerVerified`
 * is the identity-bound derivation from `isVerifiedPlayerRecord` (a linked
 * ACTIVE account) — a name-only roster entry is never marked verified.
 * It says nothing about cross-league linkage, which stays behind the
 * person's own consent (PUB-03 `mergeConsentedCareer`).
 */
export type PublicLeaderboardRow = {
  playerId: string
  playerName: string
  total: number
  playerVerified: boolean
}

/**
 * Public batting/bowling leaderboard for one tenant.
 *
 * Every read is pinned to the active league and joined to a *published*
 * tournament, so season stats still attached to a draft/cancelled competition
 * are never published, and no other league's players can appear. Results are
 * bounded and deterministically ordered (ties break on playerId).
 *
 * Format-aware (PUB-03): with a `format` filter the rows aggregate from the
 * same per-innings scorecard rows the scoring pipeline wrote, joined through
 * the innings to the match's canonical `match_format` - never inferred from a
 * tournament-level total. Without it the combined-format season aggregates
 * (player_season_stats) are used, unchanged from the combined view.
 */
async function readPublicLeaderboard(
  tenantId: string,
  metric: "runs" | "wickets",
  input: PublicLeaderboardFilterInput,
): Promise<PublicLeaderboardRow[]> {
  const filters = publicLeaderboardFilters.parse(input)
  if (filters.format) return readFormatQualifiedLeaderboard(tenantId, metric, filters)
  const column = metric === "runs" ? playerSeasonStats.runsScored : playerSeasonStats.wicketsTaken
  const innings = metric === "runs" ? playerSeasonStats.inningsBatted : playerSeasonStats.inningsBowled
  const balls = metric === "runs" ? playerSeasonStats.ballsFaced : playerSeasonStats.ballsBowled
  const rows = await db
    .select({
      playerId: playerSeasonStats.playerId,
      playerName: players.name,
      total: sum(column).mapWith(Number),
      playerUserId: players.userId,
      linkedUserActive: users.isActive,
    })
    .from(playerSeasonStats)
    .innerJoin(
      players,
      and(eq(players.id, playerSeasonStats.playerId), eq(players.tenantId, tenantId)),
    )
    .leftJoin(users, eq(users.id, players.userId))
    .innerJoin(
      tournaments,
      and(eq(tournaments.id, playerSeasonStats.tournamentId), eq(tournaments.tenantId, tenantId)),
    )
    .where(and(
      eq(playerSeasonStats.tenantId, tenantId),
      inArray(tournaments.status, [...PUBLISHED_TOURNAMENT_STATUS_VALUES]),
    ))
    .groupBy(playerSeasonStats.playerId, players.name, players.userId, users.isActive)
    // Qualify across the same published, same-league rows before ranking/limiting.
    .having(and(gte(sum(innings), filters.minimumInnings), gte(sum(balls), filters.minimumBalls)))
    .orderBy(desc(sum(column)), asc(playerSeasonStats.playerId))
    .limit(PUBLIC_LEADERBOARD_LIMIT)
  return rows.map((row) => ({
    playerId: row.playerId,
    playerName: row.playerName,
    total: row.total,
    playerVerified: isVerifiedPlayerRecord({ userId: row.playerUserId },
      row.linkedUserActive === null || row.linkedUserActive === undefined ? null : { isActive: row.linkedUserActive }),
  }))
}

/**
 * Format-qualified aggregation over the per-innings base rows (PUB-03). The
 * match's declared `matchFormat` is the only format authority; the match must
 * still sit under a published same-league tournament, so unpublished and
 * out-of-league fixtures can never qualify. Innings qualification counts the
 * per-innings rows themselves (one batting/bowling row per player per innings,
 * unique-constrained); balls qualification stays a summed aggregate.
 */
async function readFormatQualifiedLeaderboard(
  tenantId: string,
  metric: "runs" | "wickets",
  filters: PublicLeaderboardFilters,
): Promise<PublicLeaderboardRow[]> {
  const published = inArray(tournaments.status, [...PUBLISHED_TOURNAMENT_STATUS_VALUES])
  if (metric === "runs") {
    const rows = await db
      .select({
        playerId: battingScorecards.playerId,
        playerName: players.name,
        total: sum(battingScorecards.runs).mapWith(Number),
        playerUserId: players.userId,
        linkedUserActive: users.isActive,
      })
      .from(battingScorecards)
      .innerJoin(players, and(eq(players.id, battingScorecards.playerId), eq(players.tenantId, tenantId)))
      .leftJoin(users, eq(users.id, players.userId))
      .innerJoin(matchInnings, and(eq(matchInnings.id, battingScorecards.inningsId), eq(matchInnings.tenantId, tenantId)))
      .innerJoin(matches, and(eq(matches.id, matchInnings.matchId), eq(matches.tenantId, tenantId)))
      .innerJoin(tournaments, and(eq(tournaments.id, matches.tournamentId), eq(tournaments.tenantId, tenantId)))
      .where(and(
        eq(battingScorecards.tenantId, tenantId),
        // The metric-only caller guarantees a declared format; see the guard in readPublicLeaderboard.
        eq(matches.matchFormat, filters.format!),
        published,
      ))
      .groupBy(battingScorecards.playerId, players.name, players.userId, users.isActive)
      .having(and(
        gte(count(battingScorecards.id), filters.minimumInnings),
        gte(sum(battingScorecards.ballsFaced), filters.minimumBalls),
      ))
      .orderBy(desc(sum(battingScorecards.runs)), asc(battingScorecards.playerId))
      .limit(PUBLIC_LEADERBOARD_LIMIT)
    return rows.map((row) => ({
      playerId: row.playerId,
      playerName: row.playerName,
      total: row.total,
      playerVerified: isVerifiedPlayerRecord({ userId: row.playerUserId },
        row.linkedUserActive === null || row.linkedUserActive === undefined ? null : { isActive: row.linkedUserActive }),
    }))
  }
  const rows = await db
    .select({
      playerId: bowlingScorecards.playerId,
      playerName: players.name,
      total: sum(bowlingScorecards.wickets).mapWith(Number),
      playerUserId: players.userId,
      linkedUserActive: users.isActive,
    })
    .from(bowlingScorecards)
    .innerJoin(players, and(eq(players.id, bowlingScorecards.playerId), eq(players.tenantId, tenantId)))
    .leftJoin(users, eq(users.id, players.userId))
    .innerJoin(matchInnings, and(eq(matchInnings.id, bowlingScorecards.inningsId), eq(matchInnings.tenantId, tenantId)))
    .innerJoin(matches, and(eq(matches.id, matchInnings.matchId), eq(matches.tenantId, tenantId)))
    .innerJoin(tournaments, and(eq(tournaments.id, matches.tournamentId), eq(tournaments.tenantId, tenantId)))
    .where(and(
      eq(bowlingScorecards.tenantId, tenantId),
      // The metric discriminant guarantees a declared format here.
      eq(matches.matchFormat, filters.format!),
      published,
    ))
    .groupBy(bowlingScorecards.playerId, players.name, players.userId, users.isActive)
    .having(and(
      gte(count(bowlingScorecards.id), filters.minimumInnings),
      gte(sum(bowlingScorecards.ballsBowled), filters.minimumBalls),
    ))
    .orderBy(desc(sum(bowlingScorecards.wickets)), asc(bowlingScorecards.playerId))
    .limit(PUBLIC_LEADERBOARD_LIMIT)
  return rows.map((row) => ({
    playerId: row.playerId,
    playerName: row.playerName,
    total: row.total,
    playerVerified: isVerifiedPlayerRecord({ userId: row.playerUserId },
      row.linkedUserActive === null || row.linkedUserActive === undefined ? null : { isActive: row.linkedUserActive }),
  }))
}

/** Batting leaderboard for the public hub, scoped and publication-gated. */
export function readPublicBattingLeaderboard(tenantId: string, input: PublicLeaderboardFilterInput = {}) {
  return readPublicLeaderboard(tenantId, "runs", input)
}

/** Bowling leaderboard for the public hub, scoped and publication-gated. */
export function readPublicBowlingLeaderboard(tenantId: string, input: PublicLeaderboardFilterInput = {}) {
  return readPublicLeaderboard(tenantId, "wickets", input)
}

/**
 * A fielder's published total is dismissals credited on recorded fielding
 * scorecards: catches + run-outs + stumpings. `minimumMatches` is the ONLY
 * qualification that has an honest basis here — fielding scorecards are one
 * row per player per match, and `minimumInnings`/`minimumBalls` are batting/
 * bowling notions this reader deliberately ignores (the page copy says so).
 */
const FIELDING_DISMISSALS_SEASON = sql<number>`COALESCE(sum(${playerSeasonStats.catches} + ${playerSeasonStats.runOuts} + ${playerSeasonStats.stumpings}), 0)`.mapWith(Number)
const FIELDING_DISMISSALS_MATCH = sql<number>`COALESCE(sum(${fieldingScorecards.catches} + ${fieldingScorecards.runOuts} + ${fieldingScorecards.stumpings}), 0)`.mapWith(Number)

function toPublicLeaderboardRows(
  rows: Array<{ playerId: string; playerName: string; total: number; playerUserId: string | null; linkedUserActive: boolean | null }>,
): PublicLeaderboardRow[] {
  return rows.map((row) => ({
    playerId: row.playerId,
    playerName: row.playerName,
    total: row.total,
    playerVerified: isVerifiedPlayerRecord({ userId: row.playerUserId },
      row.linkedUserActive === null || row.linkedUserActive === undefined ? null : { isActive: row.linkedUserActive }),
  }))
}

/**
 * Public fielding leaderboard for one tenant (PUB-03 remainder).
 *
 * Same publication boundary as the batting/bowling boards: pinned to the
 * active league, joined to a published same-league tournament. Qualification
 * across qualifying rows happens in HAVING before ranking/limiting, results
 * are bounded, and ties break deterministically on playerId. The
 * format-qualified path aggregates the per-match `fielding_scorecards` rows
 * through the match's declared `matchFormat` — the same authority the batting
 * and bowling format views use.
 */
export async function readPublicFieldingLeaderboard(
  tenantId: string,
  input: PublicLeaderboardFilterInput = {},
): Promise<PublicLeaderboardRow[]> {
  const filters = publicLeaderboardFilters.parse(input)
  const playerProvenance = {
    playerUserId: players.userId,
    linkedUserActive: users.isActive,
  }
  if (filters.format) {
    const rows = await db
      .select({
        playerId: fieldingScorecards.playerId,
        playerName: players.name,
        total: FIELDING_DISMISSALS_MATCH,
        ...playerProvenance,
      })
      .from(fieldingScorecards)
      .innerJoin(players, and(eq(players.id, fieldingScorecards.playerId), eq(players.tenantId, tenantId)))
      .leftJoin(users, eq(users.id, players.userId))
      .innerJoin(matches, and(eq(matches.id, fieldingScorecards.matchId), eq(matches.tenantId, tenantId)))
      .innerJoin(tournaments, and(eq(tournaments.id, matches.tournamentId), eq(tournaments.tenantId, tenantId)))
      .where(and(
        eq(fieldingScorecards.tenantId, tenantId),
        eq(matches.matchFormat, filters.format),
        inArray(tournaments.status, [...PUBLISHED_TOURNAMENT_STATUS_VALUES]),
      ))
      .groupBy(fieldingScorecards.playerId, players.name, players.userId, users.isActive)
      // One fielding scorecard per player per match: count rows, not innings.
      .having(gte(count(fieldingScorecards.id), filters.minimumMatches))
      .orderBy(desc(FIELDING_DISMISSALS_MATCH), asc(fieldingScorecards.playerId))
      .limit(PUBLIC_LEADERBOARD_LIMIT)
    return toPublicLeaderboardRows(rows)
  }
  const rows = await db
    .select({
      playerId: playerSeasonStats.playerId,
      playerName: players.name,
      total: FIELDING_DISMISSALS_SEASON,
      ...playerProvenance,
    })
    .from(playerSeasonStats)
    .innerJoin(players, and(eq(players.id, playerSeasonStats.playerId), eq(players.tenantId, tenantId)))
    .leftJoin(users, eq(users.id, players.userId))
    .innerJoin(
      tournaments,
      and(eq(tournaments.id, playerSeasonStats.tournamentId), eq(tournaments.tenantId, tenantId)),
    )
    .where(and(
      eq(playerSeasonStats.tenantId, tenantId),
      inArray(tournaments.status, [...PUBLISHED_TOURNAMENT_STATUS_VALUES]),
    ))
    .groupBy(playerSeasonStats.playerId, players.name, players.userId, users.isActive)
    .having(gte(sql<number>`sum(${playerSeasonStats.matchesPlayed})`.mapWith(Number), filters.minimumMatches))
    .orderBy(desc(FIELDING_DISMISSALS_SEASON), asc(playerSeasonStats.playerId))
    .limit(PUBLIC_LEADERBOARD_LIMIT)
  return toPublicLeaderboardRows(rows)
}
