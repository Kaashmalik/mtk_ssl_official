import { db, teams, matches, tournaments, type Tournament } from "@mtk/database"
import { and, eq, count, desc, asc, inArray } from "drizzle-orm"

export const tournamentListLimit = 200

export type TournamentListRow = Tournament & {
  registeredTeams: number
  totalMatches: number
  completedMatches: number
}

/**
 * Bounded tournament list for the dashboard, with team/match counts aggregated
 * inside the exact active league. Every child count carries the same tenant
 * predicate as the list itself; a foreign team or match link cannot inflate a
 * tournament's totals.
 */
export async function readTournamentList(tenantId: string): Promise<{ truncated: boolean; tournaments: TournamentListRow[] }> {
  const rows = await db.select().from(tournaments)
    .where(eq(tournaments.tenantId, tenantId))
    .orderBy(desc(tournaments.createdAt), asc(tournaments.id))
    .limit(tournamentListLimit + 1)
  const truncated = rows.length > tournamentListLimit
  const page = truncated ? rows.slice(0, tournamentListLimit) : rows
  const ids = page.map((tournament) => tournament.id)
  if (ids.length === 0) return { truncated: false, tournaments: [] }

  const [teamRows, matchRows, completedRows] = await Promise.all([
    db.select({ tournamentId: teams.tournamentId, total: count() }).from(teams)
      .where(and(eq(teams.tenantId, tenantId), inArray(teams.tournamentId, ids)))
      .groupBy(teams.tournamentId),
    db.select({ tournamentId: matches.tournamentId, total: count() }).from(matches)
      .where(and(eq(matches.tenantId, tenantId), inArray(matches.tournamentId, ids)))
      .groupBy(matches.tournamentId),
    db.select({ tournamentId: matches.tournamentId, total: count() }).from(matches)
      .where(and(eq(matches.tenantId, tenantId), eq(matches.status, "completed"), inArray(matches.tournamentId, ids)))
      .groupBy(matches.tournamentId),
  ])

  const counter = (list: { tournamentId: string | null; total: number }[]) =>
    new Map(list.map((row) => [row.tournamentId, Number(row.total)]))
  const teamCounts = counter(teamRows)
  const matchCounts = counter(matchRows)
  const completedCounts = counter(completedRows)

  return {
    truncated,
    tournaments: page.map((tournament) => ({
      ...tournament,
      registeredTeams: teamCounts.get(tournament.id) ?? 0,
      totalMatches: matchCounts.get(tournament.id) ?? 0,
      completedMatches: completedCounts.get(tournament.id) ?? 0,
    })),
  }
}
