import { db, matches, matchInnings, matchBalls, players, teams, tenants, leagueRegistrations } from "@mtk/database"
import { eq, and, desc, asc, inArray } from "drizzle-orm"
import { applySquadEligibility } from "@/lib/squad-eligibility"

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
 * tenant as the match lookup. For tournament matches, approved squads
 * (leagueRegistrations.squadPlayerIds) filter each side's list when declared
 * (lib/squad-eligibility, rule v1) — friendlies and legacy squads without
 * player lists keep the full active roster.
 */
export async function readMatchPlayersForScoring(matchId: string, tenantId: string) {
  const [match] = await db.select({ teamAId: matches.teamAId, teamBId: matches.teamBId,
    tournamentId: matches.tournamentId })
    .from(matches)
    .where(and(eq(matches.id, matchId), eq(matches.tenantId, tenantId)))
    .limit(1)
  if (!match) return null

  let squadByTeam = new Map<string, string[]>()
  if (match.tournamentId) {
    const squads = await db.select({
      teamId: leagueRegistrations.teamId,
      squadPlayerIds: leagueRegistrations.squadPlayerIds,
    }).from(leagueRegistrations)
      .where(and(
        eq(leagueRegistrations.tenantId, tenantId),
        eq(leagueRegistrations.tournamentId, match.tournamentId),
        eq(leagueRegistrations.status, "approved"),
        inArray(leagueRegistrations.teamId, [match.teamAId, match.teamBId]),
      ))
    // squadPlayerIds is nullable at the schema level; an approval made before
  // squads existed reads as null and rule v1 treats it as "no declared squad".
  squadByTeam = new Map(squads.map(squad => [squad.teamId, squad.squadPlayerIds ?? []]))
  }

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
  return {
    teamA: applySquadEligibility(teamAPlayers, squadByTeam.get(match.teamAId)),
    teamB: applySquadEligibility(teamBPlayers, squadByTeam.get(match.teamBId)),
  }
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
