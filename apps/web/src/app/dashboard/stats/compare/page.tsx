import React from "react"
import { redirect } from "next/navigation"
import { auth } from "@clerk/nextjs/server"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@mtk/ui/components/ui/card"
import { requireActiveLeagueContext, readComparisonRoster, readPlayerComparison } from "@/lib/league-reads"
import { PlayerComparisonRadar } from "@/components/stats/player-comparison-radar"
import { ComparisonPicker } from "@/components/stats/comparison-picker"
import { unstable_noStore as noStore } from "next/cache"

export const metadata = { title: "Compare Players" }

export default async function ComparePlayersPage({
  searchParams,
}: {
  searchParams: Promise<{ a?: string; b?: string }>
}) {
  noStore()

  const { userId } = await auth()
  if (!userId) redirect("/sign-in")

  // Exact active league + stats:read. Player and scorecard reads stay in that league.
  const context = await requireActiveLeagueContext("stats:read")

  const { a, b } = await searchParams

  const roster = await readComparisonRoster(context.tenantId)

  const [playerA, playerB] = await Promise.all([
    a ? readPlayerComparison(context.tenantId, a) : Promise.resolve(null),
    b ? readPlayerComparison(context.tenantId, b) : Promise.resolve(null),
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
