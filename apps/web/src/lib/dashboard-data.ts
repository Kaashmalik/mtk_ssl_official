import { db, teams, players, tournaments, matches, matchInnings, leagueRegistrations } from "@mtk/database"
import { and, asc, count, desc, eq, inArray, isNull, or, sql } from "drizzle-orm"
import type { DashboardContext } from "./dashboard-context"
import { hasPermission } from "./rbac"
import { toDashboardMatch, type DashboardStats } from "./dashboard-model"

export type DashboardSection<T> = { status: "ready"; data: T } | { status: "unavailable" }
export async function loadDashboardSection<T>(loader: () => Promise<T>): Promise<DashboardSection<T>> {
  try { return { status: "ready", data: await loader() } }
  catch { return { status: "unavailable" } }
}

// These reads are server-only and take the already authorized active-tenant context.
export async function getDashboardStats(context: DashboardContext): Promise<DashboardStats> {
  const { tenantId } = context
  const [teamCount, playerCount, tournamentCount, matchCount] = await Promise.all([
    db.select({ value: count() }).from(teams).where(and(eq(teams.tenantId, tenantId), eq(teams.isActive, true))),
    db.select({ value: count() }).from(players).where(and(eq(players.tenantId, tenantId), eq(players.isActive, true), eq(players.status, "active"))),
    db.select({ value: count() }).from(tournaments).where(eq(tournaments.tenantId, tenantId)),
    db.select({ value: count() }).from(matches).where(eq(matches.tenantId, tenantId)),
  ])
  return { teams: Number(teamCount[0].value), players: Number(playerCount[0].value),
    tournaments: Number(tournamentCount[0].value), matches: Number(matchCount[0].value) }
}

export type DashboardMatchGroup = "live" | "upcoming" | "recent" | "assigned"
export async function getDashboardMatches(context: DashboardContext, group: DashboardMatchGroup) {
  const { tenantId, actorId } = context
  // UX-03 officiating journey: assignments are driven by the match's actual
  // officiating slots (scorer, backup scorer, and the COMP-06 member umpire
  // columns), never by the member's role - an umpire can hold ANY member role.
  const status = group === "recent" ? eq(matches.status, "completed") : group === "upcoming"
    ? eq(matches.status, "scheduled") : group === "live" ? inArray(matches.status, ["live", "innings_break", "toss"])
      : and(or(eq(matches.scorerId, actorId), eq(matches.backupScorerId, actorId),
        eq(matches.umpire1Id, actorId), eq(matches.umpire2Id, actorId)),
        inArray(matches.status, ["scheduled", "toss", "live", "innings_break"]))
  const rows = await db.select({ id: matches.id, tenantId: matches.tenantId, teamAId: matches.teamAId,
    teamBId: matches.teamBId, status: matches.status, scorerId: matches.scorerId, backupScorerId: matches.backupScorerId,
    umpire1Id: matches.umpire1Id, umpire2Id: matches.umpire2Id,
    scheduledDate: matches.scheduledDate, updatedAt: matches.updatedAt, result: matches.result })
    .from(matches).where(and(eq(matches.tenantId, tenantId), status))
    .orderBy(group === "recent" ? desc(matches.updatedAt) : group === "upcoming" ? sql`${matches.scheduledDate} ASC NULLS LAST`
      : sql`CASE WHEN ${matches.status} = 'live' THEN 0 WHEN ${matches.status} = 'innings_break' THEN 1 WHEN ${matches.status} = 'toss' THEN 2 ELSE 3 END`,
      sql`${matches.scheduledDate} ASC NULLS LAST`, asc(matches.id)).limit(5)
  if (!rows.length) return []
  const teamIds = [...new Set(rows.flatMap((m) => [m.teamAId, m.teamBId]))]
  const matchIds = rows.map((m) => m.id)
  const [teamRows, innings] = await Promise.all([
    db.select({ id: teams.id, name: teams.name }).from(teams).where(and(eq(teams.tenantId, tenantId), inArray(teams.id, teamIds))),
    db.select({ matchId: matchInnings.matchId, tenantId: matchInnings.tenantId, teamId: matchInnings.teamId,
      inningsNumber: matchInnings.inningsNumber, totalRuns: matchInnings.totalRuns,
      totalWickets: matchInnings.totalWickets, totalBalls: matchInnings.totalBalls }).from(matchInnings)
      .where(and(eq(matchInnings.tenantId, tenantId), inArray(matchInnings.matchId, matchIds))),
  ])
  const names = new Map(teamRows.map((t) => [t.id, t.name]))
  return rows.map((m) => toDashboardMatch(m, names, innings, tenantId))
}

export async function getDashboardAttention(context: DashboardContext) {
  if (!hasPermission(context.role, "match:update") || !hasPermission(context.role, "registration:manage")) return null
  const { tenantId } = context
  const [unassigned, pending] = await Promise.all([
    db.select({ value: count() }).from(matches).where(and(eq(matches.tenantId, tenantId), isNull(matches.scorerId),
      inArray(matches.status, ["scheduled", "toss", "live", "innings_break"]))),
    db.select({ value: count() }).from(leagueRegistrations).where(and(eq(leagueRegistrations.tenantId, tenantId), eq(leagueRegistrations.status, "pending"))),
  ])
  return { unassigned: Number(unassigned[0].value), pending: Number(pending[0].value) }
}
