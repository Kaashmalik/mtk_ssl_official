import { db } from "@mtk/database"
import { teams, players, matches } from "@mtk/database"
import { eq, and, or, count } from "drizzle-orm"

export async function getTeamById(id: string) {
  const [team] = await db.select().from(teams).where(eq(teams.id, id)).limit(1)
  return team ?? null
}

export async function getTeamWithRoster(id: string) {
  const [team] = await db.select().from(teams).where(eq(teams.id, id)).limit(1)
  if (!team) return null
  const roster = await db.select().from(players).where(eq(players.teamId, id))
  return { ...team, players: roster }
}

export async function getTeamPlayerCount(teamId: string): Promise<number> {
  const [result] = await db.select({ total: count() }).from(players).where(eq(players.teamId, teamId))
  return Number(result.total)
}

export async function getTeamMatchRecord(teamId: string) {
  const allMatches = await db.select().from(matches)
    .where(and(
      or(eq(matches.teamAId, teamId), eq(matches.teamBId, teamId)),
      eq(matches.status, "completed"),
    ))

  const wins = allMatches.filter((m) => m.winnerId === teamId).length
  const losses = allMatches.filter((m) => m.winnerId !== null && m.winnerId !== teamId).length
  const draws = allMatches.filter((m) => m.winnerId === null).length

  return { played: allMatches.length, wins, losses, draws }
}
