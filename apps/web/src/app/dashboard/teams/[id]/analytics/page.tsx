import Link from "next/link"
import { notFound } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@mtk/ui/components/ui/card"
import { Badge } from "@mtk/ui/components/ui/badge"
import { Button } from "@mtk/ui/components/ui/button"
import { Separator } from "@mtk/ui/components/ui/separator"
import { ArrowLeft, TrendingUp } from "lucide-react"
import {
  db, teams, players, matches, matchInnings, battingScorecards,
  bowlingScorecards, fieldingScorecards,
} from "@mtk/database"
import { and, eq, or, desc, inArray } from "drizzle-orm"
import { getMyTenant } from "@/app/actions/tenants"
import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"
import { unstable_noStore as noStore } from "next/cache"

function oversFromBalls(balls: number): string {
  return `${Math.floor(balls / 6)}.${balls % 6}`
}

export default async function TeamAnalyticsPage({ params }: { params: Promise<{ id: string }> }) {
  noStore()

  const { userId } = await auth()
  if (!userId) redirect("/sign-in")

  const { id } = await params
  const tenant = await getMyTenant()
  if (!tenant) redirect("/dashboard/league/setup")

  // Tenant-scoped: analytics must never leak across leagues.
  const [team] = await db.select().from(teams)
    .where(and(eq(teams.id, id), eq(teams.tenantId, tenant.id)))
    .limit(1)
  if (!team) notFound()

  const teamMatches = await db.select().from(matches)
    .where(and(eq(matches.tenantId, tenant.id), or(eq(matches.teamAId, id), eq(matches.teamBId, id))))
    .orderBy(desc(matches.scheduledDate))

  const matchIds = teamMatches.map((m) => m.id)

  const [batting, bowling, fielding, inningsRows] = matchIds.length
    ? await Promise.all([
        db.select().from(battingScorecards).where(inArray(battingScorecards.matchId, matchIds)),
        db.select().from(bowlingScorecards).where(inArray(bowlingScorecards.matchId, matchIds)),
        db.select().from(fieldingScorecards).where(inArray(fieldingScorecards.matchId, matchIds)),
        db.select().from(matchInnings).where(inArray(matchInnings.matchId, matchIds)),
      ])
    : [[], [], [], []]

  const teamBatting = batting.filter((b) => b.teamId === id)
  const teamBowling = bowling.filter((b) => b.teamId === id)
  const teamFielding = fielding.filter((f) => f.teamId === id)

  // --- Record summary ---
  const played = teamMatches.filter((m) => m.status === "completed").length
  const wins = teamMatches.filter((m) => m.status === "completed" && m.winnerId === id).length
  const losses = teamMatches.filter((m) => m.status === "completed" && m.winnerId && m.winnerId !== id).length
  const noResults = teamMatches.filter((m) => m.status === "no_result").length

  // --- Runs / wickets aggregates ---
  const runsScored = teamBatting.reduce((s, b) => s + b.runs, 0)
  const ballsFaced = teamBatting.reduce((s, b) => s + b.ballsFaced, 0)
  const fours = teamBatting.reduce((s, b) => s + b.fours, 0)
  const sixes = teamBatting.reduce((s, b) => s + b.sixes, 0)
  const wicketsTaken = teamBowling.reduce((s, b) => s + b.wickets, 0)
  const runsConceded = teamBowling.reduce((s, b) => s + b.runsConceded, 0)
  const ballsBowled = teamBowling.reduce((s, b) => s + b.ballsBowled, 0)
  const catches = teamFielding.reduce((s, f) => s + f.catches, 0)
  const runOuts = teamFielding.reduce((s, f) => s + f.runOuts, 0)

  const avgRunsPerMatch = played > 0 ? runsScored / played : 0
  const avgWicketsPerMatch = played > 0 ? wicketsTaken / played : 0
  const strikeRate = ballsFaced > 0 ? (runsScored / ballsFaced) * 100 : 0
  const economy = ballsBowled > 0 ? (runsConceded / ballsBowled) * 6 : 0
  const winRate = played > 0 ? (wins / played) * 100 : 0
  const boundaryRuns = fours * 4 + sixes * 6

  // --- Top performers ---
  const byId = new Map<string, typeof teamBatting>()
  for (const b of teamBatting) {
    const arr = byId.get(b.playerId) ?? []
    arr.push(b)
    byId.set(b.playerId, arr)
  }
  const batterRows = [...byId.entries()]
    .map(([playerId, rows]) => ({
      playerId,
      runs: rows.reduce((s, r) => s + r.runs, 0),
      balls: rows.reduce((s, r) => s + r.ballsFaced, 0),
      fours: rows.reduce((s, r) => s + r.fours, 0),
      sixes: rows.reduce((s, r) => s + r.sixes, 0),
      innings: rows.length,
    }))
    .sort((a, b) => b.runs - a.runs)
    .slice(0, 5)

  const bowlById = new Map<string, typeof teamBowling>()
  for (const b of teamBowling) {
    const arr = bowlById.get(b.playerId) ?? []
    arr.push(b)
    bowlById.set(b.playerId, arr)
  }
  const bowlerRows = [...bowlById.entries()]
    .map(([playerId, rows]) => ({
      playerId,
      wickets: rows.reduce((s, r) => s + r.wickets, 0),
      runs: rows.reduce((s, r) => s + r.runsConceded, 0),
      balls: rows.reduce((s, r) => s + r.ballsBowled, 0),
    }))
    .sort((a, b) => b.wickets - a.wickets || a.runs - b.runs)
    .slice(0, 5)

  const performerIds = [...batterRows, ...bowlerRows].map((r) => r.playerId)
  const performerRows = performerIds.length
    ? await db.select({ id: players.id, name: players.name }).from(players)
        .where(inArray(players.id, [...new Set(performerIds)]))
    : []
  const nameById = new Map(performerRows.map((p) => [p.id, p.name]))

  // --- Innings trend (runs scored per completed innings) ---
  const trend = inningsRows
    .filter((inn) => inn.teamId === id && inn.status === "completed")
    .sort((a, b) => a.inningsNumber - b.inningsNumber)
    .map((inn) => {
      const m = teamMatches.find((x) => x.id === inn.matchId)
      return {
        matchId: inn.matchId,
        label: m ? `M${m.matchNumber ?? "?"}` : inn.matchId.slice(0, 4),
        runs: inn.totalRuns,
        wickets: inn.totalWickets,
        overs: oversFromBalls(inn.totalBalls),
      }
    })
    .slice(-10)

  const topScorers = trend.reduce((s, t) => s + t.runs, 0)

  const stat = (label: string, value: string | number, hint?: string) => (
    <div className="rounded-lg border p-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="text-xl font-bold tabular-nums">{value}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <Link href={`/dashboard/teams/${id}`}>
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />Back to team
            </Button>
          </Link>
          <h1 className="text-3xl font-bold tracking-tight mt-2">{team.name} Analytics</h1>
          <p className="text-muted-foreground mt-1">Performance across {teamMatches.length} scheduled match{teamMatches.length === 1 ? "" : "es"}.</p>
        </div>
        <Badge variant="outline">{teamMatches.filter((m) => m.status === "live").length > 0 ? "Live now" : "No live match"}</Badge>
      </div>

      {teamMatches.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <TrendingUp className="h-10 w-10 mx-auto mb-3 opacity-30" />
            <p className="font-semibold">No matches yet</p>
            <p className="text-sm mt-1">Analytics appear once this team has played.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {stat("Matches Played", played, `${wins}W · ${losses}L${noResults ? ` · ${noResults} NR` : ""}`)}
            {stat("Win Rate", `${winRate.toFixed(0)}%`, `${wins} of ${played} won`)}
            {stat("Runs Scored", runsScored, `${avgRunsPerMatch.toFixed(1)} per match`)}
            {stat("Wickets Taken", wicketsTaken, `${avgWicketsPerMatch.toFixed(1)} per match`)}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {stat("Strike Rate", strikeRate.toFixed(1), `${oversFromBalls(ballsFaced)} balls faced`)}
            {stat("Economy", economy.toFixed(2), `${oversFromBalls(ballsBowled)} balls bowled`)}
            {stat("Boundaries", `${fours + sixes}`, `${fours} fours · ${sixes} sixes`)}
            {stat("Boundary Runs", boundaryRuns, runsScored > 0 ? `${((boundaryRuns / runsScored) * 100).toFixed(0)}% of runs` : "—")}
          </div>

          {trend.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Innings Trend</CardTitle>
                <CardDescription>Total runs in each completed innings.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {trend.map((t) => {
                  const pct = topScorers > 0 ? Math.min(100, (t.runs / topScorers) * 100) : 0
                  return (
                    <div key={t.matchId} className="flex items-center gap-3">
                      <span className="w-10 shrink-0 text-xs text-muted-foreground">{t.label}</span>
                      <div className="h-5 flex-1 rounded bg-muted overflow-hidden">
                        <div className="h-full bg-primary/80" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="w-24 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                        {t.runs}/{t.wickets} ({t.overs})
                      </span>
                    </div>
                  )
                })}
              </CardContent>
            </Card>
          )}

          <div className="grid md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Top Batters</CardTitle>
                <CardDescription>By runs scored for the team.</CardDescription>
              </CardHeader>
              <CardContent>
                {batterRows.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No batting data yet.</p>
                ) : (
                  <table className="w-full text-sm">
                    <tbody>
                      {batterRows.map((r, i) => (
                        <tr key={r.playerId} className="border-b last:border-0">
                          <td className="py-2 w-6 text-muted-foreground">{i + 1}</td>
                          <td className="py-2 font-medium">
                            <Link href={`/dashboard/players/${r.playerId}`} className="hover:underline">
                              {nameById.get(r.playerId) ?? "Unknown"}
                            </Link>
                          </td>
                          <td className="py-2 text-right tabular-nums font-semibold">{r.runs}</td>
                          <td className="py-2 text-right text-xs text-muted-foreground tabular-nums">
                            {r.innings} inn · SR {r.balls > 0 ? ((r.runs / r.balls) * 100).toFixed(1) : "0.0"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Top Bowlers</CardTitle>
                <CardDescription>By wickets taken for the team.</CardDescription>
              </CardHeader>
              <CardContent>
                {bowlerRows.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No bowling data yet.</p>
                ) : (
                  <table className="w-full text-sm">
                    <tbody>
                      {bowlerRows.map((r, i) => (
                        <tr key={r.playerId} className="border-b last:border-0">
                          <td className="py-2 w-6 text-muted-foreground">{i + 1}</td>
                          <td className="py-2 font-medium">
                            <Link href={`/dashboard/players/${r.playerId}`} className="hover:underline">
                              {nameById.get(r.playerId) ?? "Unknown"}
                            </Link>
                          </td>
                          <td className="py-2 text-right tabular-nums font-semibold">{r.wickets}</td>
                          <td className="py-2 text-right text-xs text-muted-foreground tabular-nums">
                            {r.runs} runs · Econ {r.balls > 0 ? ((r.runs / r.balls) * 6).toFixed(2) : "0.00"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Fielding</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-3">
                {stat("Catches", catches)}
                {stat("Run Outs", runOuts)}
                {stat("Dismissals", catches + runOuts)}
              </div>
            </CardContent>
          </Card>

          <Separator />

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Recent Results</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {teamMatches.slice(0, 8).map((m) => {
                const isHome = m.teamAId === id
                const won = m.winnerId === id
                return (
                  <div key={m.id} className="flex items-center justify-between rounded border p-3 text-sm">
                    <div>
                      <p className="font-medium">
                        vs {isHome ? "Away" : "Home"}
                        {m.matchNumber ? ` · Match ${m.matchNumber}` : ""}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {m.scheduledDate ? new Date(m.scheduledDate).toLocaleDateString() : "TBD"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {m.result && <span className="text-xs text-muted-foreground">{m.result}</span>}
                      <Badge variant={won ? "default" : m.status === "completed" ? "secondary" : "outline"}>
                        {m.status === "completed" ? (won ? "Won" : "Lost") : m.status}
                      </Badge>
                    </div>
                  </div>
                )
              })}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}