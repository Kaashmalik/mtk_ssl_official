import { and, asc, count, desc, eq, gte, inArray, isNotNull, isNull, sql, sum } from "drizzle-orm"
import { db, matches, tournaments, teams, matchInnings, players, users, playerSeasonStats, battingScorecards, bowlingScorecards, fieldingScorecards, matchPlayingXis, tournamentAwards, tournamentPrizes } from "@mtk/database"
import { publicLeaderboardFilters, type PublicLeaderboardFilterInput, type PublicLeaderboardFilters } from "./leaderboard-filters"
import { isVerifiedPlayerRecord } from "@mtk/database/lib/career-records"
import { isAwardVisible, AWARD_CATEGORY_LABELS, PUBLIC_AWARD_LIMIT, type AwardCategory } from "@mtk/database/lib/award-policy"
import {
  isMilestoneCentury, isMilestoneFiveFor, compareMilestoneEntries,
  MILESTONE_LIMIT, type MilestoneEntry,
} from "@mtk/database/lib/milestone-policy"
import { isPrizePubliclyVisible, PUBLIC_PRIZE_LIMIT } from "@mtk/database/lib/prize-policy"
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

/** Competition selector entries are bounded (disclosed, never silently cut). */
const PUBLIC_TOURNAMENT_OPTIONS_LIMIT = 100

/**
 * PUB-06 public field allowlists. The unauthenticated surface receives ONLY
 * these fields - provenance (createdBy), authority (captainId/managerId,
 * competition locks), tenant plumbing and internal config never leave the
 * server, even when the row itself passed the publication gate. Widening an
 * allowlist is a deliberate code change with its own review, not a side
 * effect of a select.
 */
export type PublicTournament = {
  id: string
  name: string
  description: string | null
  format: typeof tournaments.$inferSelect.format
  status: typeof tournaments.$inferSelect.status
  startDate: typeof tournaments.$inferSelect.startDate
  endDate: typeof tournaments.$inferSelect.endDate
  championTeamId: string | null
}

export type PublicMatch = {
  id: string
  tournamentId: string | null
  status: typeof matches.$inferSelect.status
  matchFormat: typeof matches.$inferSelect.matchFormat
  matchType: typeof matches.$inferSelect.matchType
  totalOvers: typeof matches.$inferSelect.totalOvers
  scheduledDate: typeof matches.$inferSelect.scheduledDate
  venueId: string | null
  teamAId: string
  teamBId: string
  tossWinnerId: string | null
  tossDecision: typeof matches.$inferSelect.tossDecision
  winnerId: string | null
  result: string | null
  manOfMatchId: string | null
  streamSource: string | null
  streamStatus: typeof matches.$inferSelect.streamStatus
  liveStreamUrl: string | null
}

export type PublicTeam = {
  id: string
  name: string
  shortName: string | null
  city: string | null
  logoUrl: string | null
  primaryColor: string | null
  secondaryColor: string | null
  homeGround: string | null
  foundedYear: number | null
}

/**
 * Reads a single tournament scoped to the tenant AND gated on publication. A
 * draft/cancelled tournament resolves to `null`, so the caller 404s exactly as
 * it would for a foreign or missing id (no signal that the row exists).
 */
export async function readPublishedTournament(tenantId: string, id: string): Promise<PublicTournament | null> {
  const [row] = await db
    .select({
      id: tournaments.id,
      name: tournaments.name,
      description: tournaments.description,
      format: tournaments.format,
      status: tournaments.status,
      startDate: tournaments.startDate,
      endDate: tournaments.endDate,
      championTeamId: tournaments.championTeamId,
    })
    .from(tournaments)
    .where(and(eq(tournaments.id, id), eq(tournaments.tenantId, tenantId)))
    .limit(1)
  if (!row || !isTournamentPublished(row.status)) return null
  return row
}

/**
 * Reads the league's published tournaments for the public index page: the
 * exact PUB-06 allowlist of `readPublishedTournament`, gated IN THE QUERY via
 * the published-status values (the same single source of truth as the single
 * read's `isTournamentPublished`). Newest-started first; the id breaks ties
 * deterministically; a draft or cancelled competition never reaches the list.
 */
export async function readPublishedTournaments(tenantId: string): Promise<PublicTournament[]> {
  return db
    .select({
      id: tournaments.id,
      name: tournaments.name,
      description: tournaments.description,
      format: tournaments.format,
      status: tournaments.status,
      startDate: tournaments.startDate,
      endDate: tournaments.endDate,
      championTeamId: tournaments.championTeamId,
    })
    .from(tournaments)
    .where(and(
      eq(tournaments.tenantId, tenantId),
      inArray(tournaments.status, PUBLISHED_TOURNAMENT_STATUS_VALUES),
    ))
    .orderBy(desc(tournaments.startDate), asc(tournaments.id))
}

/**
 * Reads a single match scoped to the tenant and gated on publication. A match
 * is hidden when it is cancelled, or when it belongs to a tournament that is
 * itself unpublished — a fixture cannot be public while its competition is a
 * draft. Matches without a tournament (friendlies) are governed by their own
 * status alone. The returned row carries the PUB-06 public allowlist only.
 */
export async function readPublishedMatch(tenantId: string, id: string): Promise<PublicMatch | null> {
  const [row] = await db
    .select({
      id: matches.id,
      tournamentId: matches.tournamentId,
      status: matches.status,
      matchFormat: matches.matchFormat,
      matchType: matches.matchType,
      totalOvers: matches.totalOvers,
      scheduledDate: matches.scheduledDate,
      venueId: matches.venueId,
      teamAId: matches.teamAId,
      teamBId: matches.teamBId,
      tossWinnerId: matches.tossWinnerId,
      tossDecision: matches.tossDecision,
      winnerId: matches.winnerId,
      result: matches.result,
      manOfMatchId: matches.manOfMatchId,
      streamSource: matches.streamSource,
      streamStatus: matches.streamStatus,
      liveStreamUrl: matches.liveStreamUrl,
    })
    .from(matches)
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
export async function readPublishedMatchTeams(tenantId: string, match: Pick<PublicMatch, "teamAId" | "teamBId">) {
  const columns = {
    id: teams.id,
    name: teams.name,
    shortName: teams.shortName,
    city: teams.city,
    logoUrl: teams.logoUrl,
    primaryColor: teams.primaryColor,
    secondaryColor: teams.secondaryColor,
    homeGround: teams.homeGround,
    foundedYear: teams.foundedYear,
  }
  const [teamA] = await db.select(columns)
    .from(teams)
    .where(and(eq(teams.id, match.teamAId), eq(teams.tenantId, tenantId))).limit(1)
  const [teamB] = await db.select(columns)
    .from(teams)
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
      // Competition/season dimension (PUB-03): optional published-tournament scoping.
      filters.tournamentId ? eq(playerSeasonStats.tournamentId, filters.tournamentId) : undefined,
      // Minor-consent gate (Batch 132): proven minors need recorded guardian consent.
      minorConsentPublicSql,
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
        filters.tournamentId ? eq(matches.tournamentId, filters.tournamentId) : undefined,
        // Minor-consent gate (Batch 132).
        minorConsentPublicSql,
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
      filters.tournamentId ? eq(matches.tournamentId, filters.tournamentId) : undefined,
      // Minor-consent gate (Batch 132).
      minorConsentPublicSql,
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

/** An entry of the competition selector on the public leaderboards page. */
export type PublicTournamentOption = { id: string; name: string }

/**
 * Competitions the leaderboards page may offer as a records-by-competition
 * dimension (PUB-03): PUBLISHED same-league tournaments only, bounded, name-
 * ordered. The readers re-apply the published-tournament gate, so an option
 * that goes stale between select render and read simply yields an empty board
 * — it can never widen the scope.
 */
export async function readPublicTournamentOptions(
  tenantId: string,
): Promise<PublicTournamentOption[]> {
  const rows = await db
    .select({ id: tournaments.id, name: tournaments.name })
    .from(tournaments)
    .where(and(
      eq(tournaments.tenantId, tenantId),
      inArray(tournaments.status, [...PUBLISHED_TOURNAMENT_STATUS_VALUES]),
    ))
    .orderBy(asc(tournaments.name), asc(tournaments.id))
    .limit(PUBLIC_TOURNAMENT_OPTIONS_LIMIT)
  return rows
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

/**
 * Minor-consent gate (Batch 132, PUB-06 + REG-06): a player with a recorded
 * date_of_birth under 18 appears on public surfaces only while a guardian
 * consent is recorded on the player row - the consent is a league-RECORDED
 * fact, never a platform-verified identity. A missing date_of_birth is never
 * guessed into a minor: the league can only gate what it has actually
 * recorded, and that DOB discipline is the disclosed foundation of this gate.
 * SQL twin of `minorPublicDecision` in @mtk/database/lib/minor-consent-policy;
 * the policy's unit tests pin the shared semantics. Withdrawing consent
 * (clearing the columns) re-withholds the records - nothing is deleted.
 *
 * ENH-01-01 (2026-10-20): the Batch-132 fragment had its age comparison
 * inverted - `date_of_birth > (CURRENT_DATE - 18 years)` is the MINOR side of
 * the boundary, so it published every proven minor unconditionally and hid
 * every consent-less adult. The adult side is `<=` (a player whose 18th
 * birthday is today is an adult and needs no consent). The consent disjunct
 * now also requires the recorded instant to be effective
 * (`consent <= now()`), matching the policy's future-consent refusal.
 * Pinned by the "minor-consent SQL twin (ENH-01-01)" contract tests; the
 * LIVE gate test proves SQL-vs-policy truth against real rows.
 */
export const minorConsentPublicSql = sql`(
  ${players}.date_of_birth IS NULL
  OR ${players}.date_of_birth <= (CURRENT_DATE - INTERVAL '18 years')
  OR (${players}.guardian_consent_at IS NOT NULL AND ${players}.guardian_consent_at <= now())
)`

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
        filters.tournamentId ? eq(matches.tournamentId, filters.tournamentId) : undefined,
        // Minor-consent gate (Batch 132).
        minorConsentPublicSql,
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
      filters.tournamentId ? eq(playerSeasonStats.tournamentId, filters.tournamentId) : undefined,
      // Minor-consent gate (Batch 132).
      minorConsentPublicSql,
      inArray(tournaments.status, [...PUBLISHED_TOURNAMENT_STATUS_VALUES]),
    ))
    .groupBy(playerSeasonStats.playerId, players.name, players.userId, users.isActive)
    .having(gte(sql<number>`sum(${playerSeasonStats.matchesPlayed})`.mapWith(Number), filters.minimumMatches))
    .orderBy(desc(FIELDING_DISMISSALS_SEASON), asc(playerSeasonStats.playerId))
    .limit(PUBLIC_LEADERBOARD_LIMIT)
  return toPublicLeaderboardRows(rows)
}

/**
 * Public wicketkeeping leaderboard (PUB-03 keeper clause, Batch 125).
 *
 * Attribution is HONEST BY CONSTRUCTION: a fielding scorecard row only ever
 * counts when its (match, team, player) is an ACTIVE DESIGNATED keeper
 * (`match_playing_xis.wicketkeeper = true AND superseded_at IS NULL`, one per
 * side by the DB partial unique). Matches declared before the designation
 * existed, and players who merely acted as keeper without being recorded,
 * contribute nothing - the page states this rather than fabricating history.
 * The combined path aggregates the same per-match rows (there is no keeper
 * marker in player_season_stats to trust), so both paths share one query with
 * the format filter switching in the WHERE clause. Same publication boundary,
 * qualification, bound and deterministic tie-break as the other boards.
 */
export async function readPublicWicketkeepingLeaderboard(
  tenantId: string,
  input: PublicLeaderboardFilterInput = {},
): Promise<PublicLeaderboardRow[]> {
  const filters = publicLeaderboardFilters.parse(input)
  const dismissals = sql<number>`COALESCE(sum(${fieldingScorecards.catches} + ${fieldingScorecards.runOuts} + ${fieldingScorecards.stumpings}), 0)`.mapWith(Number)
  const rows = await db
    .select({
      playerId: fieldingScorecards.playerId,
      playerName: players.name,
      total: dismissals,
      playerUserId: players.userId,
      linkedUserActive: users.isActive,
    })
    .from(fieldingScorecards)
    // The attribution join: the recorded keeper of THAT match and side. The
    // DB partial unique guarantees at most one active designation row, so
    // this cannot fan out.
    .innerJoin(matchPlayingXis, and(
      eq(matchPlayingXis.matchId, fieldingScorecards.matchId),
      eq(matchPlayingXis.teamId, fieldingScorecards.teamId),
      eq(matchPlayingXis.playerId, fieldingScorecards.playerId),
      eq(matchPlayingXis.tenantId, tenantId),
      eq(matchPlayingXis.wicketkeeper, true),
      isNull(matchPlayingXis.supersededAt),
    ))
    .innerJoin(players, and(eq(players.id, fieldingScorecards.playerId), eq(players.tenantId, tenantId)))
    .leftJoin(users, eq(users.id, players.userId))
    .innerJoin(matches, and(eq(matches.id, fieldingScorecards.matchId), eq(matches.tenantId, tenantId)))
    .innerJoin(tournaments, and(eq(tournaments.id, matches.tournamentId), eq(tournaments.tenantId, tenantId)))
    .where(and(
      eq(fieldingScorecards.tenantId, tenantId),
      filters.format ? eq(matches.matchFormat, filters.format) : undefined,
      filters.tournamentId ? eq(matches.tournamentId, filters.tournamentId) : undefined,
      // Minor-consent gate (Batch 132).
      minorConsentPublicSql,
      inArray(tournaments.status, [...PUBLISHED_TOURNAMENT_STATUS_VALUES]),
    ))
    .groupBy(fieldingScorecards.playerId, players.name, players.userId, users.isActive)
    .having(gte(count(fieldingScorecards.id), filters.minimumMatches))
    .orderBy(desc(dismissals), asc(fieldingScorecards.playerId))
    .limit(PUBLIC_LEADERBOARD_LIMIT)
  return toPublicLeaderboardRows(rows)
}

/** A single award gallery row with resolvable winner names (or nulls). */export type PublicTournamentAward = {
  id: string
  category: string
  categoryLabel: string
  playerId: string | null
  playerName: string | null
  teamId: string | null
  teamName: string | null
  citation: string | null
  declaredAt: Date
}

/** A single approved prize gallery row; payout records are deliberately absent. */
export type PublicTournamentPrize = {
  id: string
  categoryName: string
  placement: string | null
  /** Null = a non-cash prize. Exact 2dp decimal string. */
  amount: string | null
  currency: string
  sponsor: string | null
}

/**
 * Official award gallery for a PUBLISHED tournament (PUB-04). The caller must
 * have obtained the tournament through `readPublishedTournament` — this reader
 * re-checks nothing about the tournament itself, only that the awards are
 * same-league and active. Superseded (corrected-away) rows are never shown;
 * the shared `isAwardVisible` policy is re-applied in memory so a future
 * regression in the WHERE clause still cannot publicize an ambiguous row.
 * Fan favorites do not exist in this data and therefore cannot appear here.
 */
export async function readPublishedTournamentAwards(
  tenantId: string,
  tournamentId: string,
): Promise<PublicTournamentAward[]> {
  const rows = await db
    .select({
      id: tournamentAwards.id,
      category: tournamentAwards.category,
      playerId: tournamentAwards.playerId,
      playerName: players.name,
      teamId: tournamentAwards.teamId,
      teamName: teams.name,
      citation: tournamentAwards.citation,
      declaredAt: tournamentAwards.declaredAt,
    })
    .from(tournamentAwards)
    .leftJoin(players, and(
      eq(players.id, tournamentAwards.playerId),
      eq(players.tenantId, tenantId),
      // Minor-consent gate (Batch 132): an award won by a proven minor
      // without recorded guardian consent renders without the winner's
      // name (the LEFT JOIN simply fails to resolve) - the award record
      // itself stays public, the person's name does not.
      minorConsentPublicSql,
    ))
    .leftJoin(teams, and(eq(teams.id, tournamentAwards.teamId), eq(teams.tenantId, tenantId)))
    .where(and(
      eq(tournamentAwards.tenantId, tenantId),
      eq(tournamentAwards.tournamentId, tournamentId),
      isNull(tournamentAwards.supersededAt),
    ))
    .orderBy(asc(tournamentAwards.declaredAt), asc(tournamentAwards.id))
    .limit(PUBLIC_AWARD_LIMIT)
  return rows
    .filter((row) => isAwardVisible(row, true))
    .map((row) => ({
      id: row.id,
      category: row.category,
      categoryLabel: AWARD_CATEGORY_LABELS[row.category as AwardCategory] ?? row.category,
      playerId: row.playerId,
      playerName: row.playerName,
      teamId: row.teamId,
      teamName: row.teamName,
      citation: row.citation,
      declaredAt: row.declaredAt,
    }))
}

/**
 * PUB-05: approved, NOT-superseded tournament prizes for the public page. The
 * WHERE already pins tenant + tournament AND status = approved AND active
 * (superseded rows are corrected history); the shared `isPrizePubliclyVisible`
 * policy is re-applied in memory so a future regression in the WHERE clause
 * still cannot publicize a draft or a superseded row. Payout records are
 * league-internal and deliberately NOT exposed here — public copy must never
 * present a payout record as a platform-verified payment.
 */
export async function readPublishedTournamentPrizes(
  tenantId: string,
  tournamentId: string,
): Promise<PublicTournamentPrize[]> {
  const rows = await db
    .select({
      id: tournamentPrizes.id,
      categoryName: tournamentPrizes.categoryName,
      placement: tournamentPrizes.placement,
      amount: tournamentPrizes.amount,
      currency: tournamentPrizes.currency,
      sponsor: tournamentPrizes.sponsor,
      status: tournamentPrizes.status,
      supersededAt: tournamentPrizes.supersededAt,
    })
    .from(tournamentPrizes)
    .where(and(
      eq(tournamentPrizes.tenantId, tenantId),
      eq(tournamentPrizes.tournamentId, tournamentId),
      eq(tournamentPrizes.status, "approved"),
      isNull(tournamentPrizes.supersededAt),
    ))
    .orderBy(asc(tournamentPrizes.createdAt), asc(tournamentPrizes.id))
    .limit(PUBLIC_PRIZE_LIMIT)
  return rows
    .filter((row) => isPrizePubliclyVisible(row, true))
    .map((row) => ({
      id: row.id,
      categoryName: row.categoryName,
      placement: row.placement,
      amount: row.amount,
      currency: row.currency,
      sponsor: row.sponsor,
    }))
}

/** Hall of fame rows are bounded, newest-completed-first and disclosed. */
const PUBLIC_HALL_OF_FAME_LIMIT = 20

export type HallOfFameEntry = {
  tournamentId: string
  name: string
  championTeamId: string
  championTeamName: string
  completedAt: string | null
}

/**
 * FAN-03 league hall of fame: completed, published competitions with a
 * PERSISTED champion (written once by the completion claim). Legacy completed
 * tournaments without a champion read absent here - never re-derived, because
 * guessing which old fixture was the final is not a record. Aggregate names
 * only: no entrant-level detail leaks through this surface.
 */
export async function readPublishedHallOfFame(tenantId: string): Promise<HallOfFameEntry[]> {
  const rows = await db
    .select({
      tournamentId: tournaments.id,
      name: tournaments.name,
      championTeamId: tournaments.championTeamId,
      championTeamName: teams.name,
      updatedAt: tournaments.updatedAt,
    })
    .from(tournaments)
    .innerJoin(teams, and(eq(teams.id, tournaments.championTeamId), eq(teams.tenantId, tournaments.tenantId)))
    .where(and(
      eq(tournaments.tenantId, tenantId),
      inArray(tournaments.status, PUBLISHED_TOURNAMENT_STATUS_VALUES),
      isNotNull(tournaments.championTeamId),
    ))
    .orderBy(desc(tournaments.updatedAt))
    .limit(PUBLIC_HALL_OF_FAME_LIMIT)
  return rows
    .filter(row => row.championTeamId !== null)
    .map(row => ({
      tournamentId: row.tournamentId,
      name: row.name,
      championTeamId: row.championTeamId as string,
      championTeamName: row.championTeamName,
      completedAt: row.updatedAt.toISOString(),
    }))
}

/**
 * The persisted champion of ONE published tournament (for the public page
 * banner). A champion-less, draft or cancelled tournament reads `null`.
 */
export async function readPublishedTournamentChampion(
  tenantId: string,
  id: string,
): Promise<{ championTeamName: string; championTeamId: string } | null> {
  const [row] = await db
    .select({
      status: tournaments.status,
      championTeamId: tournaments.championTeamId,
      championTeamName: teams.name,
      teamTenantOk: teams.tenantId,
    })
    .from(tournaments)
    .leftJoin(teams, and(eq(teams.id, tournaments.championTeamId), eq(teams.tenantId, tournaments.tenantId)))
    .where(and(eq(tournaments.id, id), eq(tournaments.tenantId, tenantId)))
    .limit(1)
  if (!row || !isTournamentPublished(row.status)) return null
  if (row.championTeamId === null || row.championTeamName === null) return null
  return { championTeamName: row.championTeamName, championTeamId: row.championTeamId }
}

/**
 * FAN-03 tournament milestones: centuries (100+ run innings) and five-wicket
 * hauls (5+ wicket innings) derived from OFFICIAL scorecard rows of ONE
 * published tournament. Nothing is stored - each entry replays a verifiable
 * scorecard row through the same published-tournament gate as the
 * leaderboards, so a milestone can never exist without its official row.
 * Bounded, sorted best-first, verified-player flagged; celebration only.
 */
export type PublicMilestones = {
  centuries: MilestoneEntry[]
  fiveFors: MilestoneEntry[]
}

export async function readPublishedTournamentMilestones(
  tenantId: string,
  tournamentId: string,
): Promise<PublicMilestones> {
  const published = inArray(tournaments.status, [...PUBLISHED_TOURNAMENT_STATUS_VALUES])
  const battingRows = await db
    .select({
      playerId: battingScorecards.playerId,
      playerName: players.name,
      runs: battingScorecards.runs,
      playerUserId: players.userId,
      linkedUserActive: users.isActive,
      recordedAt: battingScorecards.createdAt,
    })
    .from(battingScorecards)
    .innerJoin(players, and(eq(players.id, battingScorecards.playerId), eq(players.tenantId, tenantId)))
    .leftJoin(users, eq(users.id, players.userId))
    .innerJoin(matches, and(eq(matches.id, battingScorecards.matchId), eq(matches.tenantId, tenantId)))
    .innerJoin(tournaments, and(eq(tournaments.id, matches.tournamentId), eq(tournaments.tenantId, tenantId)))
    .where(and(
      eq(battingScorecards.tenantId, tenantId),
      eq(matches.tournamentId, tournamentId),
      // Minor-consent gate (Batch 132): a proven minor's milestones stay off
      // the public celebration card without recorded guardian consent.
      minorConsentPublicSql,
      published,
    ))
  const centuries = battingRows
    .filter(row => isMilestoneCentury({ runs: row.runs }))
    .map(row => ({
      playerId: row.playerId,
      playerName: row.playerName,
      playerVerified: isVerifiedPlayerRecord({ userId: row.playerUserId },
        row.linkedUserActive === null || row.linkedUserActive === undefined ? null : { isActive: row.linkedUserActive }),
      value: row.runs,
      recordedAt: row.recordedAt.toISOString(),
    }))
    .sort(compareMilestoneEntries)
    .slice(0, MILESTONE_LIMIT)

  const bowlingRows = await db
    .select({
      playerId: bowlingScorecards.playerId,
      playerName: players.name,
      wickets: bowlingScorecards.wickets,
      playerUserId: players.userId,
      linkedUserActive: users.isActive,
      recordedAt: bowlingScorecards.createdAt,
    })
    .from(bowlingScorecards)
    .innerJoin(players, and(eq(players.id, bowlingScorecards.playerId), eq(players.tenantId, tenantId)))
    .leftJoin(users, eq(users.id, players.userId))
    .innerJoin(matches, and(eq(matches.id, bowlingScorecards.matchId), eq(matches.tenantId, tenantId)))
    .innerJoin(tournaments, and(eq(tournaments.id, matches.tournamentId), eq(tournaments.tenantId, tenantId)))
    .where(and(
      eq(bowlingScorecards.tenantId, tenantId),
      eq(matches.tournamentId, tournamentId),
      // Minor-consent gate (Batch 132).
      minorConsentPublicSql,
      published,
    ))
  const fiveFors = bowlingRows
    .filter(row => isMilestoneFiveFor({ wickets: row.wickets }))
    .map(row => ({
      playerId: row.playerId,
      playerName: row.playerName,
      playerVerified: isVerifiedPlayerRecord({ userId: row.playerUserId },
        row.linkedUserActive === null || row.linkedUserActive === undefined ? null : { isActive: row.linkedUserActive }),
      value: row.wickets,
      recordedAt: row.recordedAt.toISOString(),
    }))
    .sort(compareMilestoneEntries)
    .slice(0, MILESTONE_LIMIT)

  return { centuries, fiveFors }
}
