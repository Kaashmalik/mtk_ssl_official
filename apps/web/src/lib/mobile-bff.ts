import { and, desc, eq, sql } from "drizzle-orm"
import { alias } from "drizzle-orm/pg-core"
import { db, matches, teams } from "@mtk/database"
import {
  decodeMemberMatchKeyset,
  decodeCursor,
  encodeCursor,
  encodeMemberMatchKeyset,
  MATCH_STATUS_VALUES,
  MOBILE_BFF_DEFAULT_PAGE_SIZE,
  MOBILE_BFF_MAX_PAGE_SIZE,
  type MatchStatus,
  type MemberMatch,
  type MobileBffListResponse,
} from "@mtk/contracts"

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
}

export function parseMemberMatchListQuery(params: {
  cursor?: string | null
  limit?: string | null
  status?: string | null
}): { ok: true; query: MemberMatchListQuery } | { ok: false; error: string } {
  const rawLimit = params.limit ? Number.parseInt(params.limit, 10) : MOBILE_BFF_DEFAULT_PAGE_SIZE
  if (!Number.isSafeInteger(rawLimit) || rawLimit < 1 || rawLimit > MOBILE_BFF_MAX_PAGE_SIZE) {
    return { ok: false, error: `limit must be an integer between 1 and ${MOBILE_BFF_MAX_PAGE_SIZE}` }
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
  return { ok: true, query: { cursor: params.cursor ?? null, limit: rawLimit, status } }
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
  return toMemberMatch(row)
}
