import { Card, CardContent, CardHeader, CardTitle } from "@mtk/ui/components/ui/card"
import { db, playerSeasonStats, players } from "@mtk/database"
import { desc, inArray, sql, sum } from "drizzle-orm"
import { unstable_noStore as noStore } from "next/cache"

export default async function LeaderboardsPage() {
  noStore()

  const topRuns = await db
    .select({
      playerId: playerSeasonStats.playerId,
      runs: sum(playerSeasonStats.runsScored).mapWith(Number),
      wickets: sql<number>`sum(${playerSeasonStats.wicketsTaken})`.mapWith(Number),
    })
    .from(playerSeasonStats)
    .groupBy(playerSeasonStats.playerId)
    .orderBy(desc(sum(playerSeasonStats.runsScored)))
    .limit(10)

  const topWickets = await db
    .select({
      playerId: playerSeasonStats.playerId,
      wickets: sum(playerSeasonStats.wicketsTaken).mapWith(Number),
      runs: sum(playerSeasonStats.runsScored).mapWith(Number),
    })
    .from(playerSeasonStats)
    .groupBy(playerSeasonStats.playerId)
    .orderBy(desc(sum(playerSeasonStats.wicketsTaken)))
    .limit(10)

  const ids = Array.from(new Set([...topRuns.map(r => r.playerId), ...topWickets.map(r => r.playerId)]))
  const playerRows = ids.length
    ? await db.select({ id: players.id, name: players.name }).from(players).where(inArray(players.id, ids))
    : []
  const nameById = new Map(playerRows.map(p => [p.id, p.name]))

  return (
    <div className="max-w-4xl mx-auto space-y-6 p-4">
      <h1 className="text-2xl font-bold">Leaderboards</h1>
      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle>Top Run Scorers</CardTitle></CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <tbody>
                {topRuns.map((r, i) => (
                  <tr key={r.playerId} className="border-b last:border-0">
                    <td className="py-2 w-6 text-muted-foreground">{i + 1}</td>
                    <td className="py-2 font-medium">{nameById.get(r.playerId) ?? "Unknown"}</td>
                    <td className="py-2 text-right font-semibold tabular-nums">{r.runs}</td>
                  </tr>
                ))}
                {topRuns.length === 0 && <tr><td className="py-4 text-center text-muted-foreground">No stats yet.</td></tr>}
              </tbody>
            </table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Top Wicket Takers</CardTitle></CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <tbody>
                {topWickets.map((r, i) => (
                  <tr key={r.playerId} className="border-b last:border-0">
                    <td className="py-2 w-6 text-muted-foreground">{i + 1}</td>
                    <td className="py-2 font-medium">{nameById.get(r.playerId) ?? "Unknown"}</td>
                    <td className="py-2 text-right font-semibold tabular-nums">{r.wickets}</td>
                  </tr>
                ))}
                {topWickets.length === 0 && <tr><td className="py-4 text-center text-muted-foreground">No stats yet.</td></tr>}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
