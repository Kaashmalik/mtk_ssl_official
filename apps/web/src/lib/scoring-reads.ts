import { db, matches, matchInnings, matchBalls, players, teams, tenants } from "@mtk/database"
import { eq, and, desc, asc } from "drizzle-orm"

/**
 * Scoring feature reads. Every function is predicated on an explicit,
 * caller-resolved `tenantId` — the same active-league scoping contract as the
 * other lib readers. No writes live here: deliveries, innings transitions and
 * match completion belong to the scoring-service (source of truth), which the
 * action module gates and proxies to. These reads authorise those commands and
 * hydrate the scoring UI.
 */

/** The active league row for gating; null when it disappeared. */
export async function findScoringTenant(tenantId: string) {
  return db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) })
}

/** Full innings row of the exact match+league, for the record-ball command gate. */
export async function readInningsForCommand(inningsId: string, matchId: string, tenantId: string) {
  const [innings] = await db.select().from(matchInnings)
    .where(and(eq(matchInnings.id, inningsId), eq(matchInnings.matchId, matchId),
      eq(matchInnings.tenantId, tenantId)))
    .limit(1)
  return innings ?? null
}

/** Innings-id-only lookup of the exact match+league (complete/history gates). */
export async function findInningsId(inningsId: string, matchId: string, tenantId: string) {
  const [owned] = await db.select({ id: matchInnings.id })
    .from(matchInnings)
    .where(and(
      eq(matchInnings.id, inningsId),
      eq(matchInnings.matchId, matchId),
      eq(matchInnings.tenantId, tenantId),
    ))
    .limit(1)
  return owned ?? null
}

/** One match of the exact league, for the scoring page. */
export async function findScoringMatch(matchId: string, tenantId: string) {
  const [match] = await db.select().from(matches)
    .where(and(eq(matches.id, matchId), eq(matches.tenantId, tenantId)))
    .limit(1)
  return match ?? null
}

/**
 * Batch hydration for the scoring page: both team names, all innings in order
 * and the 60 most recent balls (returned chronological).
 */
export async function readMatchScoringBatch(matchId: string, teamAId: string, teamBId: string, tenantId: string) {
  const [teamA, teamB, allInnings, recentBalls] = await Promise.all([
    db.select({ id: teams.id, name: teams.name }).from(teams)
      .where(and(eq(teams.id, teamAId), eq(teams.tenantId, tenantId))).limit(1),
    db.select({ id: teams.id, name: teams.name }).from(teams)
      .where(and(eq(teams.id, teamBId), eq(teams.tenantId, tenantId))).limit(1),
    db.select().from(matchInnings)
      .where(and(eq(matchInnings.matchId, matchId), eq(matchInnings.tenantId, tenantId)))
      .orderBy(asc(matchInnings.inningsNumber)),
    db.select().from(matchBalls)
      .where(and(eq(matchBalls.matchId, matchId), eq(matchBalls.tenantId, tenantId)))
      .orderBy(desc(matchBalls.createdAt))
      .limit(60),
  ])
  return { teamA, teamB, allInnings, recentBalls }
}

/**
 * Both teams' active players for the scoring selectors. Returns null when the
 * match is not in the league; the two player reads are predicated on the same
 * tenant as the match lookup.
 */
export async function readMatchPlayersForScoring(matchId: string, tenantId: string) {
  const [match] = await db.select({ teamAId: matches.teamAId, teamBId: matches.teamBId })
    .from(matches)
    .where(and(eq(matches.id, matchId), eq(matches.tenantId, tenantId)))
    .limit(1)
  if (!match) return null
  const [teamAPlayers, teamBPlayers] = await Promise.all([
    db.select({ id: players.id, name: players.name, role: players.role })
      .from(players)
      .where(and(eq(players.teamId, match.teamAId), eq(players.tenantId, tenantId),
        eq(players.isActive, true), eq(players.status, "active")))
      .orderBy(asc(players.name)),
    db.select({ id: players.id, name: players.name, role: players.role })
      .from(players)
      .where(and(eq(players.teamId, match.teamBId), eq(players.tenantId, tenantId),
        eq(players.isActive, true), eq(players.status, "active")))
      .orderBy(asc(players.name)),
  ])
  return { teamA: teamAPlayers, teamB: teamBPlayers }
}

/**
 * Ball-by-ball history for one innings of the exact league. The innings gate
 * keeps tenant scope (historically the missing bound in this read).
 */
export async function readBallHistory(matchId: string, inningsId: string, tenantId: string) {
  const owned = await findInningsId(inningsId, matchId, tenantId)
  if (!owned) return null
  return db.select().from(matchBalls)
    .where(and(
      eq(matchBalls.matchId, matchId),
      eq(matchBalls.inningsId, inningsId),
      eq(matchBalls.tenantId, tenantId),
    ))
    .orderBy(asc(matchBalls.ballSequence))
}
