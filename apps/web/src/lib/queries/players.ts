import { db } from "@mtk/database"
import { players, teams, playerSeasonStats, tournaments } from "@mtk/database"
import { eq, desc } from "drizzle-orm"

export async function getPlayerById(id: string) {
  const [player] = await db.select().from(players).where(eq(players.id, id)).limit(1)
  return player ?? null
}

export async function getPlayerWithTeam(id: string) {
  const result = await db.select({
    player: players,
    team: teams,
  }).from(players)
    .leftJoin(teams, eq(players.teamId, teams.id))
    .where(eq(players.id, id))
    .limit(1)
  return result[0] ?? null
}

export async function getPlayerSeasonStats(playerId: string) {
  return db.select({
    stats: playerSeasonStats,
    tournament: tournaments,
  }).from(playerSeasonStats)
    .leftJoin(tournaments, eq(playerSeasonStats.tournamentId, tournaments.id))
    .where(eq(playerSeasonStats.playerId, playerId))
    .orderBy(desc(tournaments.startDate))
}

export async function getPlayerCareerStats(playerId: string) {
  const stats = await db.select().from(playerSeasonStats)
    .where(eq(playerSeasonStats.playerId, playerId))
  
  if (stats.length === 0) return null

  // Aggregate career stats across all seasons
  return stats.reduce((career, s) => ({
    matchesPlayed: career.matchesPlayed + s.matchesPlayed,
    runsScored: career.runsScored + s.runsScored,
    ballsFaced: career.ballsFaced + s.ballsFaced,
    fours: career.fours + s.fours,
    sixes: career.sixes + s.sixes,
    fifties: career.fifties + s.fifties,
    hundreds: career.hundreds + s.hundreds,
    highestScore: Math.max(career.highestScore, s.highestScore),
    wicketsTaken: career.wicketsTaken + s.wicketsTaken,
    catches: career.catches + s.catches,
    runOuts: career.runOuts + s.runOuts,
    stumpings: career.stumpings + s.stumpings,
    seasons: career.seasons + 1,
  }), {
    matchesPlayed: 0, runsScored: 0, ballsFaced: 0,
    fours: 0, sixes: 0, fifties: 0, hundreds: 0, highestScore: 0,
    wicketsTaken: 0, catches: 0, runOuts: 0, stumpings: 0, seasons: 0,
  })
}

export async function getTopRunScorers(tournamentId: string, limit = 10) {
  return db.select().from(playerSeasonStats)
    .where(eq(playerSeasonStats.tournamentId, tournamentId))
    .orderBy(desc(playerSeasonStats.runsScored))
    .limit(limit)
}

export async function getTopWicketTakers(tournamentId: string, limit = 10) {
  return db.select().from(playerSeasonStats)
    .where(eq(playerSeasonStats.tournamentId, tournamentId))
    .orderBy(desc(playerSeasonStats.wicketsTaken))
    .limit(limit)
}
