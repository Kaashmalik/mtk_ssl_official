import { db, teams, tournaments, matches, matchInnings, battingScorecards, bowlingScorecards, fanFollows } from "@mtk/database"
import { and, eq, or, inArray, asc, desc, count, sql } from "drizzle-orm"

async function teamNames(tenantId: string, ids: string[]) {
  return ids.length ? db.select({ id: teams.id, name: teams.name }).from(teams)
    .where(and(eq(teams.tenantId, tenantId), inArray(teams.id, [...new Set(ids)]))) : []
}

/** Call only after an authorized parent in this exact league. No row locks. */
export async function readRosterTeamHistory(tenantId: string, teamId: string) {
  const fixtures = await db.select().from(matches).where(and(eq(matches.tenantId, tenantId),
    or(eq(matches.teamAId, teamId), eq(matches.teamBId, teamId)))).orderBy(desc(matches.scheduledDate), asc(matches.id))
  if (!fixtures.length) return { fixtures, names: [], innings: [] }
  const ids = fixtures.map(match => match.id)
  const [names, innings] = await Promise.all([
    teamNames(tenantId, fixtures.flatMap(match => [match.teamAId, match.teamBId])),
    db.select().from(matchInnings).where(and(eq(matchInnings.tenantId, tenantId), inArray(matchInnings.matchId, ids),
      sql`exists (SELECT 1 FROM ${matches} WHERE ${matches.id} = ${matchInnings.matchId}
        AND ${matches.tenantId} = ${tenantId} AND (${matchInnings.teamId} = ${matches.teamAId} OR ${matchInnings.teamId} = ${matches.teamBId}))`))
      .orderBy(asc(matchInnings.inningsNumber), asc(matchInnings.id)),
  ])
  return { fixtures, names, innings }
}

export function rosterPerformanceScope(table: typeof battingScorecards | typeof bowlingScorecards, tenantId: string, playerId: string) {
  return and(eq(table.playerId, playerId), eq(table.tenantId, tenantId),
    sql`exists (SELECT 1 FROM ${matches} WHERE ${matches.id} = ${table.matchId} AND ${matches.tenantId} = ${tenantId}
      AND (${table.teamId} = ${matches.teamAId} OR ${table.teamId} = ${matches.teamBId})
      AND exists (SELECT 1 FROM ${teams} WHERE ${teams.id} = ${table.teamId} AND ${teams.tenantId} = ${tenantId})
      AND exists (SELECT 1 FROM ${matchInnings} WHERE ${matchInnings.id} = ${table.inningsId}
        AND ${matchInnings.matchId} = ${table.matchId} AND ${matchInnings.tenantId} = ${tenantId}
        AND (${matchInnings.teamId} = ${matches.teamAId} OR ${matchInnings.teamId} = ${matches.teamBId})))`)
}
export async function readRosterPlayerHistory(tenantId: string, playerId: string) {
  const [batting, bowling] = await Promise.all([
    db.select().from(battingScorecards).where(rosterPerformanceScope(battingScorecards, tenantId, playerId)),
    db.select().from(bowlingScorecards).where(rosterPerformanceScope(bowlingScorecards, tenantId, playerId)),
  ])
  const ids = [...new Set([...batting, ...bowling].map(card => card.matchId))]
  const fixtures = ids.length ? await db.select().from(matches)
    .where(and(eq(matches.tenantId, tenantId), inArray(matches.id, ids))).orderBy(desc(matches.scheduledDate), asc(matches.id)) : []
  const tournamentIds = [...new Set(fixtures.map(match => match.tournamentId).filter((id): id is string => !!id))]
  const [names, competitions] = await Promise.all([
    teamNames(tenantId, fixtures.flatMap(match => [match.teamAId, match.teamBId])),
    tournamentIds.length ? db.select({ id: tournaments.id, name: tournaments.name }).from(tournaments)
      .where(and(eq(tournaments.tenantId, tenantId), inArray(tournaments.id, tournamentIds))) : [],
  ])
  return { batting, bowling, fixtures, names, competitions }
}

/** Historical side comes from performance rows, never today's mutable roster. */
export function rosterHistoricalSide(matchId: string, cards: { matchId: string; teamId: string }[]) {
  const sides = [...new Set(cards.filter(card => card.matchId === matchId).map(card => card.teamId))]
  return sides.length === 1 ? sides[0] : null
}

// Dashboard reads only. Follow mutations now live in lib/fan-follows with the
// exact active league and the account UUID (never the Clerk identity).
export async function readRosterFollowState(tenantId: string, actorId: string, kind: "team" | "player", id: string) {
  const scope = and(eq(fanFollows.tenantId, tenantId), eq(fanFollows.followableType, kind), eq(fanFollows.followableId, id))
  const [[total], [mine]] = await Promise.all([
    db.select({ total: count() }).from(fanFollows).where(scope),
    db.select({ total: count() }).from(fanFollows).where(and(scope, eq(fanFollows.userId, actorId))),
  ])
  return { following: Number(mine.total) > 0, followers: Number(total.total) }
}
