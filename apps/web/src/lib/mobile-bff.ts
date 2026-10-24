import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { announcements, db, matches, playerSeasonStats, players, teams } from "@mtk/database"
import {
  decodeCursor,
  decodeMemberMatchKeyset,
  decodeNameKeyset,
  encodeCursor,
  encodeMemberMatchKeyset,
  encodeNameKeyset,
  MATCH_STATUS_VALUES,
  MOBILE_BFF_DEFAULT_PAGE_SIZE,
  MOBILE_BFF_MAX_PAGE_SIZE,
  type AnnouncementItem,
  type MatchStatus,
  type MemberMatch,
  type MemberPlayer,
  type MemberTeam,
  type MobileBffListResponse,
} from "@mtk/contracts"
import { readPublishedMatchPlayback } from "@/lib/broadcast-playback"

/**
 * ENH-03-03: the native BFF reads. Server-side authority only: the caller
 * (the route) resolves the session user and their ACTIVE league, and this
 * reader scopes every query to that exact tenant. Responses are member
 * projections (`MemberMatch`) - never raw rows - and lists are keyset
 * paginated on (createdAt DESC, id DESC): a 60-fixture league pages as
 * 25+25+10, it never truncates at 50.
 *
 * The cursor is the opaque versioned envelope from @mtk/contracts; the
 * keyset tuple rides inside its `after` marker. A corrupted cursor throws
 * (decodeCursor contract) and the route turns that into 400 - it must not
 * rewind to page one and duplicate rows.
 */

export type MemberMatchPage = MobileBffListResponse<MemberMatch>

/** Parsed and validated list-query parameters (clamped, never silent-failed). */
export type MemberMatchListQuery = {
  cursor: string | null
  limit: number
  status: MatchStatus | null
  /** Optional single-team fixtures filter (native team detail). */
  teamId: string | null
}

import { isUuid } from "@mtk/contracts"

export function parseMemberMatchListQuery(params: {
  cursor?: string | null
  limit?: string | null
  status?: string | null
  teamId?: string | null
}): { ok: true; query: MemberMatchListQuery } | { ok: false; error: string } {
  const rawLimit = params.limit ? Number.parseInt(params.limit, 10) : MOBILE_BFF_DEFAULT_PAGE_SIZE
  if (!Number.isSafeInteger(rawLimit) || rawLimit < 1 || rawLimit > MOBILE_BFF_MAX_PAGE_SIZE) {
    return { ok: false, error: `limit must be an integer between 1 and ${MOBILE_BFF_MAX_PAGE_SIZE}` }
  }
  // Batch 144: the loose 36-char class accepted thirty-six dashes; the
  // canonical contract shape is the only id this BFF forwards.
  if (params.teamId !== undefined && params.teamId !== null && !isUuid(params.teamId)) {
    return { ok: false, error: "teamId must be a uuid" }
  }
  let status: MatchStatus | null = null
  if (params.status && params.status !== "all") {
    if (!(MATCH_STATUS_VALUES as readonly string[]).includes(params.status)) {
      return { ok: false, error: `status must be one of: ${MATCH_STATUS_VALUES.join(", ")}` }
    }
    status = params.status as MatchStatus
  }
  // A corrupted cursor is refused here (decodeCursor throws on malformed
  // envelopes) - the route maps that to 400 so the client refetches page
  // one deliberately, never by silent rewind.
  if (params.cursor) {
    let payload: ReturnType<typeof decodeCursor> = null
    try {
      payload = decodeCursor(params.cursor)
    } catch {
      return { ok: false, error: "cursor is not a valid match-page cursor" }
    }
    if (!payload || !decodeMemberMatchKeyset(payload.after)) {
      return { ok: false, error: "cursor is not a valid match-page cursor" }
    }
  }
  return { ok: true, query: { cursor: params.cursor ?? null, limit: rawLimit, status, teamId: params.teamId ?? null } }
}

function toIsoOrNull(value: Date | string | null): string | null {
  if (value === null) return null
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

/** THE row → `MemberMatch` projection (shared by the list and single reads). */
function toMemberMatch(row: { match: typeof matches.$inferSelect; teamAName: string; teamBName: string }): MemberMatch {
  const { match, teamAName, teamBName } = row
  return {
    id: match.id,
    tournamentId: match.tournamentId,
    status: match.status,
    matchFormat: match.matchFormat,
    matchType: match.matchType,
    totalOvers: match.totalOvers,
    scheduledDate: toIsoOrNull(match.scheduledDate),
    venueId: match.venueId,
    teamAId: match.teamAId,
    teamBId: match.teamBId,
    teamAName,
    teamBName,
    tossWinnerId: match.tossWinnerId,
    tossDecision: match.tossDecision,
    winnerId: match.winnerId,
    result: match.result,
    manOfMatchId: match.manOfMatchId,
    streamSource: match.streamSource,
    streamStatus: match.streamStatus,
    liveStreamUrl: match.liveStreamUrl,
  }
}

/** One cursor-paginated page of the member's league matches, name-joined. */
export async function readMemberMatchPage(input: {
  userId: string
  tenantId: string
  /** Parsed query from `parseMemberMatchListQuery`. */
  query: MemberMatchListQuery
}): Promise<MemberMatchPage> {
  const { tenantId, query } = input

  const conditions = [eq(matches.tenantId, tenantId)]
  if (query.status) conditions.push(eq(matches.status, query.status))
  if (query.teamId) {
    conditions.push(or(eq(matches.teamAId, query.teamId), eq(matches.teamBId, query.teamId))!)
  }
  if (query.cursor) {
    const payload = decodeCursor(query.cursor)!
    const keyset = decodeMemberMatchKeyset(payload.after)!
    // Tuple keyset: (createdAt, id) strictly before the marker, so a page
    // boundary mutation can neither duplicate a row nor skip one silently.
    conditions.push(
      sql`(${matches.createdAt}, ${matches.id}) < (${keyset.createdAtIso}::timestamptz, ${keyset.matchId}::uuid)`,
    )
  }

  const teamA = alias(teams, "team_a")
  const teamB = alias(teams, "team_b")
  const rows = await db
    .select({ match: matches, teamAName: teamA.name, teamBName: teamB.name })
    .from(matches)
    .innerJoin(teamA, eq(matches.teamAId, teamA.id))
    .innerJoin(teamB, eq(matches.teamBId, teamB.id))
    .where(and(...conditions))
    .orderBy(desc(matches.createdAt), desc(matches.id))
    .limit(query.limit + 1)

  const hasMore = rows.length > query.limit
  const pageRows = hasMore ? rows.slice(0, query.limit) : rows

  const items: MemberMatch[] = pageRows.map(toMemberMatch)

  const last = pageRows.at(-1)
  const nextCursor =
    hasMore && last
      ? encodeCursor({
          v: 1,
          after: encodeMemberMatchKeyset(last.match.createdAt.toISOString(), last.match.id),
        })
      : null

  return { items, nextCursor }
}

/** One member projection by id - the native match-detail fetch. */
export async function readMemberMatch(input: {
  userId: string
  tenantId: string
  matchId: string
}): Promise<MemberMatch | null> {
  const teamA = alias(teams, "team_a")
  const teamB = alias(teams, "team_b")
  const [row] = await db
    .select({ match: matches, teamAName: teamA.name, teamBName: teamB.name })
    .from(matches)
    .innerJoin(teamA, eq(matches.teamAId, teamA.id))
    .innerJoin(teamB, eq(matches.teamBId, teamB.id))
    .where(and(eq(matches.tenantId, input.tenantId), eq(matches.id, input.matchId)))
    .limit(1)
  if (!row) return null
  const match = toMemberMatch(row)
  // ENH-08-03: the single detail read carries the truthful playback summary
  // (flag-gated; legacy live remains the fallback). The list stays one query.
  const playback = await readPublishedMatchPlayback(input.tenantId, match)
  return {
    ...match,
    playback: {
      state: playback.state,
      hasReplay: playback.replays.length > 0,
    },
  }
}

/**
 * Generic member list-query parsing for the name-keyed directories (teams,
 * players): the keyset tuple rides in the same versioned cursor envelope,
 * with the name as the marker.
 */
export type MemberDirectoryListQuery = { cursor: string | null; limit: number }

export function parseMemberDirectoryListQuery(params: {
  cursor?: string | null
  limit?: string | null
}): { ok: true; query: MemberDirectoryListQuery } | { ok: false; error: string } {
  const parsedLimit = parseMemberMatchListQuery({ limit: params.limit })
  if (!parsedLimit.ok) return parsedLimit
  if (params.cursor) {
    try {
      const payload = decodeCursor(params.cursor)
      if (!payload || !decodeNameKeyset(payload.after)) {
        return { ok: false, error: "cursor is not a valid page cursor" }
      }
    } catch {
      return { ok: false, error: "cursor is not a valid page cursor" }
    }
  }
  return {
    ok: true,
    query: { cursor: params.cursor ?? null, limit: parsedLimit.query.limit },
  }
}

function directory_select() {
  // teams.id/name/short_name/logo_url - the PublicTeam disclosure set.
  return {
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
}

/** The league's teams, name-ascending, keyset paginated. */
export async function readMemberTeams(input: {
  tenantId: string
  query: MemberDirectoryListQuery
}): Promise<MobileBffListResponse<MemberTeam>> {
  const conditions = [eq(teams.tenantId, input.tenantId)]
  if (input.query.cursor) {
    const keyset = decodeNameKeyset(decodeCursor(input.query.cursor)!.after)!
    conditions.push(sql`(${teams.name}, ${teams.id}) > (${keyset.name}::text, ${keyset.id}::uuid)`)
  }
  const rows = await db
    .select(directory_select())
    .from(teams)
    .where(and(...conditions))
    .orderBy(asc(teams.name), asc(teams.id))
    .limit(input.query.limit + 1)
  const hasMore = rows.length > input.query.limit
  const pageRows = hasMore ? rows.slice(0, input.query.limit) : rows
  const last = pageRows.at(-1)
  return {
    items: pageRows,
    nextCursor:
      hasMore && last ? encodeCursor({ v: 1, after: encodeNameKeyset(last.name, last.id) }) : null,
  }
}

/** One member team by id (native team-detail header). */
export async function readMemberTeam(input: {
  tenantId: string
  teamId: string
}): Promise<MemberTeam | null> {
  const [row] = await db
    .select(directory_select())
    .from(teams)
    .where(and(eq(teams.tenantId, input.tenantId), eq(teams.id, input.teamId)))
    .limit(1)
  return row ?? null
}

function player_select() {
  return {
    id: players.id,
    name: players.name,
    teamId: players.teamId,
    teamName: teams.name,
    jerseyNumber: players.jerseyNumber,
    role: players.role,
    battingStyle: players.battingStyle,
    bowlingStyle: players.bowlingStyle,
  }
}

type PlayerRow = {
  id: string
  name: string
  teamId: string | null
  teamName: string | null
  jerseyNumber: number | null
  role: string | null
  battingStyle: string | null
  bowlingStyle: string | null
}

function toMemberPlayer(row: PlayerRow): MemberPlayer {
  return {
    id: row.id,
    name: row.name,
    teamId: row.teamId,
    teamName: row.teamName,
    jerseyNumber: row.jerseyNumber,
    role: (row.role as MemberPlayer["role"]) ?? null,
    battingStyle: (row.battingStyle as MemberPlayer["battingStyle"]) ?? null,
    bowlingStyle: (row.bowlingStyle as MemberPlayer["bowlingStyle"]) ?? null,
  }
}

/** The league's players (optionally one team's roster), name-ascending. */
export async function readMemberPlayers(input: {
  tenantId: string
  teamId?: string | null
  query: MemberDirectoryListQuery
}): Promise<MobileBffListResponse<MemberPlayer>> {
  const conditions = [eq(players.tenantId, input.tenantId)]
  if (input.teamId) conditions.push(eq(players.teamId, input.teamId))
  if (input.query.cursor) {
    const keyset = decodeNameKeyset(decodeCursor(input.query.cursor)!.after)!
    conditions.push(sql`(${players.name}, ${players.id}) > (${keyset.name}::text, ${keyset.id}::uuid)`)
  }
  const rows = await db
    .select(player_select())
    .from(players)
    .leftJoin(teams, eq(players.teamId, teams.id))
    .where(and(...conditions))
    .orderBy(asc(players.name), asc(players.id))
    .limit(input.query.limit + 1)
  const hasMore = rows.length > input.query.limit
  const pageRows = hasMore ? rows.slice(0, input.query.limit) : rows
  const last = pageRows.at(-1)
  return {
    items: pageRows.map(toMemberPlayer),
    nextCursor:
      hasMore && last ? encodeCursor({ v: 1, after: encodeNameKeyset(last.name, last.id) }) : null,
  }
}

/**
 * One member player by id, with the per-tournament season aggregates from
 * `player_season_stats` (the DB-owned numbers, never re-derived here).
 */
export async function readMemberPlayer(input: {
  tenantId: string
  playerId: string
}): Promise<MemberPlayer | null> {
  const [row] = await db
    .select(player_select())
    .from(players)
    .leftJoin(teams, eq(players.teamId, teams.id))
    .where(and(eq(players.tenantId, input.tenantId), eq(players.id, input.playerId)))
    .limit(1)
  if (!row) return null
  const statRows = await db
    .select()
    .from(playerSeasonStats)
    .where(and(eq(playerSeasonStats.tenantId, input.tenantId), eq(playerSeasonStats.playerId, input.playerId)))
    .orderBy(asc(playerSeasonStats.tournamentId))
  const player = toMemberPlayer(row)
  player.seasonStats = statRows.map((s) => ({
    tournamentId: s.tournamentId,
    matchesPlayed: s.matchesPlayed ?? 0,
    runsScored: s.runsScored ?? 0,
    ballsFaced: s.ballsFaced ?? 0,
    inningsBatted: s.inningsBatted ?? 0,
    notOuts: s.notOuts ?? 0,
    fours: s.fours ?? 0,
    sixes: s.sixes ?? 0,
    highestScore: s.highestScore ?? 0,
    isHighestScoreNotOut: s.isHighestScoreNotOut ?? false,
    fifties: s.fifties ?? 0,
    hundreds: s.hundreds ?? 0,
    ducks: s.ducks ?? 0,
    battingAverage: s.battingAverage ?? null,
    strikeRate: s.strikeRate ?? null,
    wicketsTaken: s.wicketsTaken ?? 0,
    oversBowled: s.oversBowled ?? null,
    ballsBowled: s.ballsBowled ?? 0,
    runsConceded: s.runsConceded ?? 0,
    inningsBowled: s.inningsBowled ?? 0,
    maidens: s.maidens ?? 0,
    bowlingAverage: s.bowlingAverage ?? null,
    economyRate: s.economyRate ?? null,
    bowlingStrikeRate: s.bowlingStrikeRate ?? null,
    bestBowlingWickets: s.bestBowlingWickets ?? 0,
    bestBowlingRuns: s.bestBowlingRuns ?? 0,
    fourWicketHauls: s.fourWicketHauls ?? 0,
    fiveWicketHauls: s.fiveWicketHauls ?? 0,
    catches: s.catches ?? 0,
    runOuts: s.runOuts ?? 0,
    stumpings: s.stumpings ?? 0,
  }))
  return player
}

/**
 * Platform announcements, audience-gated. PUBLIC surface: callable signed
 * out (then only audience `all` applies); a signed-in member additionally
 * sees plan-matched ('pro'/'enterprise') and tenant-targeted ones. The 20-
 * row hard cap of the native news screen becomes cursor pagination.
 */
export async function readAnnouncements(input: {
  tenantId: string | null
  tenantPlan: string | null
  query: MemberDirectoryListQuery
}): Promise<MobileBffListResponse<AnnouncementItem>> {
  const now = sql`now()`
  const conditions = [
    eq(announcements.isActive, true),
    or(isNull(announcements.startDate), lte(announcements.startDate, now)),
    or(isNull(announcements.endDate), gte(announcements.endDate, now)),
  ]
  if (input.query.cursor) {
    const keyset = decodeMemberMatchKeyset(decodeCursor(input.query.cursor)!.after)!
    conditions.push(
      sql`(${announcements.createdAt}, ${announcements.id}) < (${keyset.createdAtIso}::timestamptz, ${keyset.matchId}::uuid)`,
    )
  }
  const rows = await db
    .select()
    .from(announcements)
    .where(and(...conditions, audienceSql(input.tenantId, input.tenantPlan)))
    .orderBy(desc(announcements.createdAt), desc(announcements.id))
    .limit(input.query.limit + 1)
  const hasMore = rows.length > input.query.limit
  const pageRows = hasMore ? rows.slice(0, input.query.limit) : rows
  const last = pageRows.at(-1)
  return {
    items: pageRows.map((a) => ({
      id: a.id,
      title: a.title,
      summary: a.message,
      publishedAt: a.createdAt.toISOString(),
      type: a.type,
      priority: a.priority,
      actionUrl: a.actionUrl,
      actionText: a.actionText,
    })),
    nextCursor:
      hasMore && last
        ? encodeCursor({ v: 1, after: encodeMemberMatchKeyset(last.createdAt.toISOString(), last.id) })
        : null,
  }
}

/**
 * Audience gate: target_audience is 'all', a plan name ('pro'/'enterprise')
 * or a JSON array of tenant ids. Signed-out sees only 'all'; a member sees
 * 'all', their plan, or their tenant id.
 */
function audienceSql(tenantId: string | null, tenantPlan: string | null) {
  const planIn = tenantPlan ? [tenantPlan] : []
  const clauses = [eq(announcements.targetAudience, "all")]
  if (planIn.length > 0) clauses.push(inArray(announcements.targetAudience, planIn))
  if (tenantId) {
    // JSON-array targeting: ['id1','id2'] - match as text containment on
    // the quoted id, which the JSON encoder always emits for uuid strings.
    clauses.push(sql`${announcements.targetAudience} LIKE ${`%"${tenantId}"%`}`)
  }
  return or(...clauses)!
}
