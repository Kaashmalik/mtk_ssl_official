import { auth } from "@clerk/nextjs/server"
import {
  db, users, userTenantRoles, tenants, players, teams, matches,
  battingScorecards, bowlingScorecards, fieldingScorecards,
} from "@mtk/database"
import { and, eq, or, desc, asc, inArray, sum, sql } from "drizzle-orm"
import { z } from "zod"
import { resolveActiveTenantId, requirePermissionServer } from "./rbac-server"
import { hasPermission, type Permission, type UserRole } from "./rbac"

export type ActiveLeagueContext = { tenantId: string; actorId: string; clerkId: string; role: UserRole }

/** Request-local authorization for dashboard reads in the exact active league. */
export async function requireActiveLeagueContext(permission: Permission): Promise<ActiveLeagueContext> {
  const { userId: clerkId } = await auth()
  if (!clerkId) throw new Error("Unauthorized")
  const tenantId = await resolveActiveTenantId()
  if (!tenantId) throw new Error("Tenant not found")
  await requirePermissionServer(permission, tenantId)
  const actor = await db.query.users.findFirst({ where: eq(users.clerkId, clerkId) })
  if (!actor || actor.clerkId !== clerkId || actor.isActive !== true) throw new Error("Forbidden: league account unavailable")
  const membership = await db.query.userTenantRoles.findFirst({ where: and(
    eq(userTenantRoles.userId, actor.id), eq(userTenantRoles.tenantId, tenantId)) })
  const league = await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) })
  if (!membership || membership.userId !== actor.id || membership.tenantId !== tenantId
    || membership.status !== "active" || membership.role === "super_admin" || !hasPermission(membership.role, permission)
    || !league || league.id !== tenantId || league.isActive !== true) {
    throw new Error("Forbidden: league access unavailable")
  }
  return { tenantId, actorId: actor.id, clerkId, role: membership.role }
}

export const leaderboardLimit = z.number().int().min(1).max(50).default(5)
export const comparisonRosterLimit = z.number().int().min(1).max(200).default(100)

export type LeaderboardRow = { playerId: string; playerName: string; teamName: string; total: string | null }

/** Batting leaderboard. Player and team joins carry the same active-league predicate. */
export async function readBattingLeaderboard(tenantId: string, metric: "runs" | "sixes" | "fours", limit = 5) {
  const column = metric === "runs" ? battingScorecards.runs
    : metric === "sixes" ? battingScorecards.sixes : battingScorecards.fours
  return db.select({
    playerId: battingScorecards.playerId, playerName: players.name, teamName: teams.name, total: sum(column),
  })
    .from(battingScorecards)
    .innerJoin(players, and(eq(players.id, battingScorecards.playerId), eq(players.tenantId, tenantId)))
    .innerJoin(teams, and(eq(teams.id, battingScorecards.teamId), eq(teams.tenantId, tenantId)))
    .where(eq(battingScorecards.tenantId, tenantId))
    .groupBy(battingScorecards.playerId, players.name, teams.name)
    .orderBy(desc(sum(column)), asc(battingScorecards.playerId))
    .limit(leaderboardLimit.parse(limit)) as Promise<LeaderboardRow[]>
}

/** Bowling leaderboard, tenant-scoped on the scorecards, players and teams. */
export async function readBowlingLeaderboard(tenantId: string, limit = 5) {
  return db.select({
    playerId: bowlingScorecards.playerId, playerName: players.name, teamName: teams.name, total: sum(bowlingScorecards.wickets),
  })
    .from(bowlingScorecards)
    .innerJoin(players, and(eq(players.id, bowlingScorecards.playerId), eq(players.tenantId, tenantId)))
    .innerJoin(teams, and(eq(teams.id, bowlingScorecards.teamId), eq(teams.tenantId, tenantId)))
    .where(eq(bowlingScorecards.tenantId, tenantId))
    .groupBy(bowlingScorecards.playerId, players.name, teams.name)
    .orderBy(desc(sum(bowlingScorecards.wickets)), asc(bowlingScorecards.playerId))
    .limit(leaderboardLimit.parse(limit)) as Promise<LeaderboardRow[]>
}

/** Bounded same-league roster for the comparison picker. */
export async function readComparisonRoster(tenantId: string, limit = 100) {
  return db.select({ id: players.id, name: players.name }).from(players)
    .where(eq(players.tenantId, tenantId))
    .orderBy(desc(players.name), asc(players.id))
    .limit(comparisonRosterLimit.parse(limit))
}

export type ComparisonPlayer = {
  id: string; name: string; runs: number; battingAverage: number; strikeRate: number;
  wickets: number; bowlingAverage: number; economy: number; catches: number;
}

/** Compare a player's aggregate output. Every child scorecard read is tenant-scoped. */
export async function readPlayerComparison(tenantId: string, playerId: string): Promise<ComparisonPlayer | null> {
  z.string().uuid().parse(playerId)
  const [player] = await db.select({ id: players.id, name: players.name }).from(players)
    .where(and(eq(players.id, playerId), eq(players.tenantId, tenantId))).limit(1)
  if (!player) return null

  const [batting, bowling, fielding] = await Promise.all([
    db.select().from(battingScorecards).where(and(eq(battingScorecards.playerId, playerId),
      eq(battingScorecards.tenantId, tenantId))),
    db.select().from(bowlingScorecards).where(and(eq(bowlingScorecards.playerId, playerId),
      eq(bowlingScorecards.tenantId, tenantId))),
    db.select().from(fieldingScorecards).where(and(eq(fieldingScorecards.playerId, playerId),
      eq(fieldingScorecards.tenantId, tenantId))),
  ])

  const runs = batting.reduce((acc, row) => acc + row.runs, 0)
  const dismissals = batting.filter((row) => row.dismissalType && row.dismissalType !== "not_out").length
  const outs = dismissals > 0 ? dismissals : batting.length
  const wickets = bowling.reduce((acc, row) => acc + row.wickets, 0)
  const runsConceded = bowling.reduce((acc, row) => acc + row.runsConceded, 0)
  const ballsBowled = bowling.reduce((acc, row) => acc + row.ballsBowled, 0)
  const ballsFaced = batting.reduce((acc, row) => acc + row.ballsFaced, 0)

  return {
    id: player.id, name: player.name, runs,
    battingAverage: outs > 0 ? Number((runs / outs).toFixed(2)) : 0,
    strikeRate: ballsFaced > 0 ? Number(((runs / ballsFaced) * 100).toFixed(2)) : 0,
    wickets,
    bowlingAverage: wickets > 0 ? Number((runsConceded / wickets).toFixed(2)) : 0,
    economy: ballsBowled > 0 ? Number(((runsConceded / ballsBowled) * 6).toFixed(2)) : 0,
    catches: fielding.reduce((acc, row) => acc + row.catches + row.runOuts + row.stumpings, 0),
  }
}

export const scoringConsoleLimit = 100

/** Active/scheduled matches for the scoring console plus their same-league team names. */
export async function readScoringConsoleMatches(tenantId: string) {
  const rows = await db.select().from(matches)
    .where(and(eq(matches.tenantId, tenantId), or(
      eq(matches.status, "live"), eq(matches.status, "scheduled"),
      eq(matches.status, "toss"), eq(matches.status, "innings_break"))))
    .orderBy(sql`case when ${matches.status} in ('live', 'innings_break') then 0 else 1 end`,
      asc(matches.scheduledDate), asc(matches.id))
    .limit(scoringConsoleLimit + 1)
  const truncated = rows.length > scoringConsoleLimit
  const page = truncated ? rows.slice(0, scoringConsoleLimit) : rows

  const teamIds = [...new Set(page.flatMap((match) => [match.teamAId, match.teamBId]).filter(Boolean))]
  const names = teamIds.length
    ? await db.select({ id: teams.id, name: teams.name }).from(teams)
        .where(and(eq(teams.tenantId, tenantId), inArray(teams.id, teamIds)))
    : []
  const nameById = new Map(names.map((team) => [team.id, team.name]))

  return {
    truncated,
    matches: page.map((match) => ({
      ...match,
      teamAName: nameById.get(match.teamAId) ?? "TBD Team A",
      teamBName: nameById.get(match.teamBId) ?? "TBD Team B",
    })),
  }
}
