import { redirect } from "next/navigation"
import { auth } from "@clerk/nextjs/server"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@mtk/ui/components/ui/card"
import { db, players, battingScorecards, bowlingScorecards, fieldingScorecards } from "@mtk/database"
import { and, eq, desc } from "drizzle-orm"
import { getMyTenant } from "@/app/actions/tenants"
import { PlayerComparisonRadar, type ComparisonPlayer } from "@/components/stats/player-comparison-radar"
import { ComparisonPicker } from "@/components/stats/comparison-picker"
import { unstable_noStore as noStore } from "next/cache"

export const metadata = { title: "Compare Players" }

async function loadPlayer(tenantId: string, playerId: string): Promise<ComparisonPlayer | null> {
  const [player] = await db.select({ id: players.id, name: players.name })
    .from(players)
    .where(and(eq(players.id, playerId), eq(players.tenantId, tenantId)))
    .limit(1)
  if (!player) return null

  const [batting, bowling, fielding] = await Promise.all([
    db.select().from(battingScorecards).where(eq(battingScorecards.playerId, playerId)),
    db.select().from(bowlingScorecards).where(eq(bowlingScorecards.playerId, playerId)),
    db.select().from(fieldingScorecards).where(eq(fieldingScorecards.playerId, playerId)),
  ])

  const runs = batting.reduce((s, r) => s + r.runs, 0)
  const dismissals = batting.filter(
    (r) => r.dismissalType && r.dismissalType !== "not_out",
  ).length
  const outs = dismissals > 0 ? dismissals : batting.length

  const wickets = bowling.reduce((s, r) => s + r.wickets, 0)
  const runsConceded = bowling.reduce((s, r) => s + r.runsConceded, 0)
  const ballsBowled = bowling.reduce((s, r) => s + r.ballsBowled, 0)
  const ballsFaced = batting.reduce((s, r) => s + r.ballsFaced, 0)

  return {
    id: player.id,
    name: player.name,
    runs,
    battingAverage: outs > 0 ? Number((runs / outs).toFixed(2)) : 0,
    strikeRate: ballsFaced > 0 ? Number(((runs / ballsFaced) * 100).toFixed(2)) : 0,
    wickets,
    bowlingAverage: wickets > 0 ? Number((runsConceded / wickets).toFixed(2)) : 0,
    economy: ballsBowled > 0 ? Number(((runsConceded / ballsBowled) * 6).toFixed(2)) : 0,
    catches: fielding.reduce((s, f) => s + f.catches + f.runOuts + f.stumpings, 0),
  }
}

export default async function ComparePlayersPage({
  searchParams,
}: {
  searchParams: Promise<{ a?: string; b?: string }>
}) {
  noStore()

  const { userId } = await auth()
  if (!userId) redirect("/sign-in")

  const tenant = await getMyTenant()
  if (!tenant) redirect("/dashboard/league/setup")

  const { a, b } = await searchParams

  const roster = await db
    .select({ id: players.id, name: players.name })
    .from(players)
    .where(eq(players.tenantId, tenant.id))
    .orderBy(desc(players.name))
    .limit(200)

  const [playerA, playerB] = await Promise.all([
    a ? loadPlayer(tenant.id, a) : Promise.resolve(null),
    b ? loadPlayer(tenant.id, b) : Promise.resolve(null),
  ])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Compare Players</h1>
        <p className="text-muted-foreground mt-1">
          Compare batting, bowling, and fielding output side by side.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Select Players</CardTitle>
          <CardDescription>{roster.length} players in your league.</CardDescription>
        </CardHeader>
        <CardContent>
          {roster.length < 2 ? (
            <p className="text-sm text-muted-foreground">
              Add at least two players to compare them.
            </p>
          ) : (
            <ComparisonPicker
              players={roster}
              initialA={a ?? roster[0].id}
              initialB={b ?? roster[1].id}
            />
          )}
        </CardContent>
      </Card>

      {playerA && playerB ? (
        <PlayerComparisonRadar a={playerA} b={playerB} />
      ) : (
        playerA || playerB ? (
          <Card>
            <CardContent className="py-10 text-center text-muted-foreground text-sm">
              Choose two players to see the comparison.
            </CardContent>
          </Card>
        ) : null
      )}
    </div>
  )
}