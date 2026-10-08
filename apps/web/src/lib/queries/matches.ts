import { db } from "@mtk/database"
import { matches, matchInnings, teams } from "@mtk/database"
import { eq, and, desc } from "drizzle-orm"

export async function getMatchById(id: string) {
  const [match] = await db.select().from(matches).where(eq(matches.id, id)).limit(1)
  return match ?? null
}

export async function getMatchWithTeams(id: string) {
  const [match] = await db.select().from(matches).where(eq(matches.id, id)).limit(1)
  if (!match) return null

  const [teamA, teamB, innings] = await Promise.all([
    db.select().from(teams).where(eq(teams.id, match.teamAId)).limit(1),
    db.select().from(teams).where(eq(teams.id, match.teamBId)).limit(1),
    db.select().from(matchInnings).where(eq(matchInnings.matchId, id)),
  ])

  return {
    ...match,
    teamA: teamA[0] ?? null,
    teamB: teamB[0] ?? null,
    innings,
  }
}

export async function getLiveMatches(tenantId: string) {
  return db.select().from(matches)
    .where(and(eq(matches.tenantId, tenantId), eq(matches.status, "live")))
    .orderBy(desc(matches.startDate))
}

export async function getUpcomingMatches(tenantId: string, limit = 5) {
  return db.select().from(matches)
    .where(and(eq(matches.tenantId, tenantId), eq(matches.status, "scheduled")))
    .orderBy(matches.scheduledDate)
    .limit(limit)
}

export async function getRecentResults(tenantId: string, limit = 5) {
  return db.select().from(matches)
    .where(and(eq(matches.tenantId, tenantId), eq(matches.status, "completed")))
    .orderBy(desc(matches.endDate))
    .limit(limit)
}
