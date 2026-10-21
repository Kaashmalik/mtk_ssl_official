import { and, count, desc, eq, inArray, lt, or, sql } from "drizzle-orm"
import { db, matchInnings, matches, teams } from "@mtk/database"
import {
  decodePageCursor,
  encodePageCursor,
  parseMobileFixturePage,
  type CursorPage,
  type MobileFixtureV1,
  type PageCursor,
} from "@mtk/contracts"
import { computeStandings, STANDINGS_RULE_VERSION, type StandingsRow } from "./standings"

/**
 * ENH-03-03: the read half of the mobile BFF.
 *
 * The native app reads the league through these readers — NEVER through raw
 * Supabase rows. One documented mobile BFF convention: member reads live
 * under `/api/mobile/<resource>`, authenticate with the Clerk session, and
 * resolve the tenant SERVER-SIDE (a query/body tenantId can never widen a
 * read). Fixture lists come back in the shared contracts `CursorPage`
 * envelope behind the strict `MobileFixtureV1` projection: explicit fields,
 * resolved team names, and the FULL lifecycle vocabulary (forfeited and
 * postponed included) — a raw database row, a snake_case column or a
 * fabricated team name can never reach the device again. An alternative
 * version prefix requires ADR review; there is deliberately no second
 * native-read convention.
 *
 * Pagination is keyset pagination over (scheduled_date, id) — NULL
 * scheduled dates sort last through a COALESCE so every fixture is reachable
 * in a stable order (>50-fixture leagues page fully, no offset drift, no
 * silent truncation). The envelope `revision` is the tenant-scoped count of
 * fixtures in the same scope, so a consumer can detect a feed that moved
 * under it between page requests.
 */

export const MOBILE_FIXTURE_PAGE_SIZE = 25

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A synthetic sort key marking the NULL-scheduled-date tail of the feed. */
const INFINITY_SORT_KEY = "+infinity"

export class MobileCursorError extends Error {}

/**
 * Validates and decodes the `cursor` query value. Anything that was not
 * produced by the shared codec — or whose sort key is not a timestamp this
 * feed produced — is refused loudly rather than silently page-zeroed.
 */
export function parseMobilePageCursor(raw: string | null): PageCursor | null {
  if (raw === null || raw === "") return null
  const decoded = decodePageCursor(raw)
  if (!decoded) throw new MobileCursorError("The page cursor is not usable")
  if (decoded.sortKey !== INFINITY_SORT_KEY && Number.isNaN(Date.parse(decoded.sortKey))) {
    throw new MobileCursorError("The page cursor is not usable")
  }
  return decoded
}

const fixtureColumns = {
  id: matches.id,
  tenantId: matches.tenantId,
  tournamentId: matches.tournamentId,
  status: matches.status,
  scheduledDate: matches.scheduledDate,
  startedAt: matches.startDate,
  completedAt: matches.endDate,
  team1Id: matches.teamAId,
  team2Id: matches.teamBId,
  winnerId: matches.winnerId,
  result: matches.result,
  tossWinnerId: matches.tossWinnerId,
  tossDecision: matches.tossDecision,
  liveStreamUrl: matches.liveStreamUrl,
  streamStatus: matches.streamStatus,
}

// NULL scheduled dates sort LAST in the feed; the COALESCE makes the keyset
// total (strictly ordered) so pagination can reach every fixture.
const scheduledSortKey = sql`COALESCE(${matches.scheduledDate}, 'infinity'::timestamptz)`

function sortKeyBound(sortKey: string) {
  return sortKey === INFINITY_SORT_KEY ? sql`'infinity'::timestamptz` : new Date(sortKey)
}

async function readTeamNames(tenantId: string, teamIds: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(teamIds)]
  if (unique.length === 0) return new Map()
  const rows = await db
    .select({ id: teams.id, name: teams.name })
    .from(teams)
    .where(and(eq(teams.tenantId, tenantId), inArray(teams.id, unique)))
  return new Map(rows.map((row) => [row.id, row.name]))
}

type FixtureRecord = {
  id: string
  tenantId: string
  tournamentId: string | null
  status: typeof matches.$inferSelect.status
  scheduledDate: Date | null
  startedAt: Date | null
  completedAt: Date | null
  team1Id: string
  team2Id: string
  winnerId: string | null
  result: string | null
  tossWinnerId: string | null
  tossDecision: "bat" | "bowl" | null
  liveStreamUrl: string | null
  streamStatus: "idle" | "live" | "ended" | null
}

async function projectFixtures(
  tenantId: string,
  records: FixtureRecord[],
): Promise<MobileFixtureV1[]> {
  const names = await readTeamNames(tenantId, records.flatMap((row) => [row.team1Id, row.team2Id]))
  return records.map((row) => ({
    id: row.id,
    tenantId: row.tenantId,
    tournamentId: row.tournamentId,
    status: row.status,
    scheduledDate: row.scheduledDate instanceof Date ? row.scheduledDate.toISOString() : null,
    startedAt: row.startedAt instanceof Date ? row.startedAt.toISOString() : null,
    completedAt: row.completedAt instanceof Date ? row.completedAt.toISOString() : null,
    team1Id: row.team1Id,
    team2Id: row.team2Id,
    team1Name: names.get(row.team1Id) ?? null,
    team2Name: names.get(row.team2Id) ?? null,
    winnerId: row.winnerId,
    result: row.result,
    tossWinnerId: row.tossWinnerId,
    tossDecision: row.tossDecision,
    liveStreamUrl: row.liveStreamUrl,
    streamStatus: row.streamStatus,
  }))
}

function cursorKeyOf(row: Pick<FixtureRecord, "scheduledDate">): string {
  return row.scheduledDate instanceof Date ? row.scheduledDate.toISOString() : INFINITY_SORT_KEY
}

/**
 * One page of the league's fixtures for the signed-in member's active
 * tenant. This is the MEMBER projection: every lifecycle state of a real
 * fixture is served explicitly (the native list must be able to say
 * "postponed" or "forfeited" instead of silently omitting the fixture);
 * publication filtering governs the public surface, not a league's own
 * signed-in members.
 */
export async function readMobileFixtures(
  tenantId: string,
  options: { tournamentId?: string | null; cursor?: PageCursor | null } = {},
): Promise<CursorPage<MobileFixtureV1>> {
  const scope = [eq(matches.tenantId, tenantId)]
  if (options.tournamentId) scope.push(eq(matches.tournamentId, options.tournamentId))

  const cursor = options.cursor ?? null
  const rows = await db
    .select(fixtureColumns)
    .from(matches)
    .where(cursor
      ? and(
          ...scope,
          or(
            lt(scheduledSortKey, sortKeyBound(cursor.sortKey)),
            and(eq(scheduledSortKey, sortKeyBound(cursor.sortKey)), lt(matches.id, cursor.id)),
          ),
        )
      : and(...scope))
    .orderBy(desc(scheduledSortKey), desc(matches.id))
    .limit(MOBILE_FIXTURE_PAGE_SIZE + 1)

  const hasMore = rows.length > MOBILE_FIXTURE_PAGE_SIZE
  const pageRows = rows.slice(0, MOBILE_FIXTURE_PAGE_SIZE)
  const [countRow] = await db
    .select({ value: count().mapWith(Number) })
    .from(matches)
    .where(and(...scope))

  const nextCursor = hasMore && pageRows.length > 0
    ? encodePageCursor({ sortKey: cursorKeyOf(pageRows[pageRows.length - 1]), id: pageRows[pageRows.length - 1].id })
    : null

  return parseMobileFixturePage({
    items: await projectFixtures(tenantId, pageRows),
    nextCursor,
    revision: countRow?.value ?? pageRows.length,
  })
}

/** One fixture's member projection, or null for a foreign/missing id (404). */
export async function readMobileFixtureById(tenantId: string, id: string): Promise<MobileFixtureV1 | null> {
  const [row] = await db
    .select(fixtureColumns)
    .from(matches)
    .where(and(eq(matches.tenantId, tenantId), eq(matches.id, id)))
    .limit(1)
  if (!row) return null
  const [projected] = await projectFixtures(tenantId, [row])
  // Reuse the strict page projection so a single read can never be looser
  // than the paginated feed.
  return parseMobileFixturePage({ items: [projected], nextCursor: null, revision: 1 }).items[0]
}

export type MobileStandings = {
  ruleVersion: number
  /** Number of league fixtures the table was computed over (staleness signal). */
  revision: number
  rows: StandingsRow[]
}

/**
 * The canonical standings (points table) for the native app: computed by the
 * SHARED rule v2 fold (`computeStandings`) from league rows — balls-based
 * net run rate, 2/1/0 points, forfeited/postponed/abandoned fixtures handled
 * by the rule (only completed and no-result fixtures are "played") — never
 * re-derived on device. Without a tournament filter the table spans the
 * whole active league; with one, it is that competition's table.
 */
export async function readMobileStandings(
  tenantId: string,
  options: { tournamentId?: string | null } = {},
): Promise<MobileStandings> {
  const matchScope = [eq(matches.tenantId, tenantId)]
  if (options.tournamentId) matchScope.push(eq(matches.tournamentId, options.tournamentId))

  const [teamRows, matchRows, inningsRows] = await Promise.all([
    db
      .select({ id: teams.id, name: teams.name, shortName: teams.shortName })
      .from(teams)
      .where(eq(teams.tenantId, tenantId)),
    db
      .select({
        id: matches.id,
        teamAId: matches.teamAId,
        teamBId: matches.teamBId,
        status: matches.status,
        winnerId: matches.winnerId,
        groupLabel: matches.groupLabel,
      })
      .from(matches)
      .where(and(...matchScope)),
    db
      .select({
        matchId: matchInnings.matchId,
        teamId: matchInnings.teamId,
        runs: matchInnings.totalRuns,
        balls: matchInnings.totalBalls,
      })
      .from(matchInnings)
      .where(eq(matchInnings.tenantId, tenantId)),
  ])

  const inningsByMatch = new Map<string, { teamId: string; runs: number; balls: number }[]>()
  for (const innings of inningsRows) {
    const list = inningsByMatch.get(innings.matchId) ?? []
    list.push({ teamId: innings.teamId, runs: Number(innings.runs), balls: Number(innings.balls) })
    inningsByMatch.set(innings.matchId, list)
  }

  const rows = computeStandings({
    teams: teamRows,
    matches: matchRows.map((row) => ({
      matchId: row.id,
      teamAId: row.teamAId,
      teamBId: row.teamBId,
      status: row.status,
      winnerId: row.winnerId,
      groupLabel: row.groupLabel,
      innings: inningsByMatch.get(row.id) ?? [],
    })),
  })

  return { ruleVersion: STANDINGS_RULE_VERSION, revision: matchRows.length, rows }
}

export { UUID_PATTERN as MOBILE_UUID_PATTERN }
