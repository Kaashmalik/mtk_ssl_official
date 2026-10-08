import { db } from "@mtk/database"
import { teams, players, tournaments, matches } from "@mtk/database"
import { eq, and, count, desc } from "drizzle-orm"

export async function getDashboardStats(tenantId: string) {
  const [
    [{ totalTeams }],
    [{ totalPlayers }],
    [{ totalTournaments }],
    [{ totalMatches }],
    [{ liveMatches }],
  ] = await Promise.all([
    db.select({ totalTeams: count() }).from(teams).where(eq(teams.tenantId, tenantId)),
    db.select({ totalPlayers: count() }).from(players).where(eq(players.tenantId, tenantId)),
    db.select({ totalTournaments: count() }).from(tournaments).where(eq(tournaments.tenantId, tenantId)),
    db.select({ totalMatches: count() }).from(matches).where(eq(matches.tenantId, tenantId)),
    db.select({ liveMatches: count() }).from(matches).where(and(eq(matches.tenantId, tenantId), eq(matches.status, "live"))),
  ])

  return {
    totalTeams: Number(totalTeams),
    totalPlayers: Number(totalPlayers),
    totalTournaments: Number(totalTournaments),
    totalMatches: Number(totalMatches),
    liveMatches: Number(liveMatches),
  }
}

export async function getRecentActivity(tenantId: string) {
  const [recentMatches, recentTeams, recentPlayers] = await Promise.all([
    db.select().from(matches).where(eq(matches.tenantId, tenantId)).orderBy(desc(matches.updatedAt)).limit(5),
    db.select().from(teams).where(eq(teams.tenantId, tenantId)).orderBy(desc(teams.createdAt)).limit(3),
    db.select().from(players).where(eq(players.tenantId, tenantId)).orderBy(desc(players.createdAt)).limit(3),
  ])
  return { recentMatches, recentTeams, recentPlayers }
}
