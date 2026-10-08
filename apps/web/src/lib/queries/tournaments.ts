import { db } from "@mtk/database"
import { tournaments, matches, leagueRegistrations } from "@mtk/database"
import { eq, and, desc, count } from "drizzle-orm"

export async function getTournamentById(id: string) {
  const [tournament] = await db.select().from(tournaments).where(eq(tournaments.id, id)).limit(1)
  return tournament ?? null
}

export async function getTournamentTeamCount(tournamentId: string): Promise<number> {
  const [result] = await db.select({ total: count() }).from(leagueRegistrations)
    .where(and(eq(leagueRegistrations.tournamentId, tournamentId), eq(leagueRegistrations.status, "approved")))
  return Number(result.total)
}

export async function getTournamentMatchCount(tournamentId: string): Promise<number> {
  const [result] = await db.select({ total: count() }).from(matches)
    .where(eq(matches.tournamentId, tournamentId))
  return Number(result.total)
}

export async function getTournamentOverview(id: string) {
  const [tournament, teamCount, matchCount] = await Promise.all([
    getTournamentById(id),
    getTournamentTeamCount(id),
    getTournamentMatchCount(id),
  ])
  if (!tournament) return null

  const recentMatches = await db.select().from(matches)
    .where(and(eq(matches.tournamentId, id), eq(matches.status, "completed")))
    .orderBy(desc(matches.endDate))
    .limit(5)

  return { ...tournament, teamCount, matchCount, recentMatches }
}
