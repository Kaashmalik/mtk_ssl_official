import React from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@mtk/ui/components/ui/card"
import { unstable_noStore as noStore } from "next/cache"
import { requirePublicTenantId } from "@/lib/public-tenant"
import { readPublicBattingLeaderboard, readPublicBowlingLeaderboard } from "@/lib/public-visibility"

export default async function LeaderboardsPage() {
  noStore()

  // Public leaderboards are scoped to the league that owns the request host and
  // only count published competitions. Previously this aggregated
  // player_season_stats and players across EVERY tenant.
  const tenantId = await requirePublicTenantId()
  const [topRuns, topWickets] = await Promise.all([
    readPublicBattingLeaderboard(tenantId),
    readPublicBowlingLeaderboard(tenantId),
  ])

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
                    <td className="py-2 font-medium">{r.playerName}</td>
                    <td className="py-2 text-right font-semibold tabular-nums">{r.total}</td>
                  </tr>
                ))}
                {topRuns.length === 0 && <tr><td colSpan={3} className="py-4 text-center text-muted-foreground">No stats yet.</td></tr>}
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
                    <td className="py-2 font-medium">{r.playerName}</td>
                    <td className="py-2 text-right font-semibold tabular-nums">{r.total}</td>
                  </tr>
                ))}
                {topWickets.length === 0 && <tr><td colSpan={3} className="py-4 text-center text-muted-foreground">No stats yet.</td></tr>}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
