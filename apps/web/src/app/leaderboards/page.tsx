import React from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@mtk/ui/components/ui/card"
import { unstable_noStore as noStore } from "next/cache"
import { requirePublicTenantId } from "@/lib/public-tenant"
import { readPublicBattingLeaderboard, readPublicBowlingLeaderboard, readPublicFieldingLeaderboard } from "@/lib/public-visibility"
import { parsePublicLeaderboardSearch, PUBLIC_LEADERBOARD_MAX_MINIMUM, PUBLIC_LEADERBOARD_FORMATS, publicLeaderboardFormatLabel, type PublicLeaderboardSearch } from "@/lib/leaderboard-filters"

export default async function LeaderboardsPage({ searchParams }: { searchParams?: Promise<PublicLeaderboardSearch> }) {
  noStore()

  // Public leaderboards are scoped to the league that owns the request host and
  // only count published competitions. Previously this aggregated
  // player_season_stats and players across EVERY tenant.
  const tenantId = await requirePublicTenantId()
  const parsed = parsePublicLeaderboardSearch(await searchParams ?? {})
  // Invalid input is visible, not silently reset to a broader unqualified list.
  const [topRuns, topWickets, topFielders] = parsed.success ? await Promise.all([
    readPublicBattingLeaderboard(tenantId, parsed.data),
    readPublicBowlingLeaderboard(tenantId, parsed.data),
    readPublicFieldingLeaderboard(tenantId, parsed.data),
  ]) : [[], [], []]

  const format = parsed.success ? parsed.data.format : undefined
  const formatLabel = publicLeaderboardFormatLabel(format)
  return (
    <div className="max-w-4xl mx-auto space-y-6 p-4">
      <h1 className="text-2xl font-bold">Leaderboards</h1>
      <p className="text-sm text-muted-foreground">{formatLabel ? `Published ${formatLabel}-format totals for this league only, aggregated from the per-innings scorecards of matches declared ${formatLabel}.` : "Published competition season totals in this league only. Formats are combined when no format filter is selected."} These are not official records or league awards. A check mark marks a roster entry linked to an active player account; cross-league career views are separate and only shown with the person's own consent.</p>
      <form method="get" className="flex flex-wrap items-end gap-4">
        <div className="space-y-1">
          <label htmlFor="format" className="block text-sm font-medium">Match format</label>
          <select id="format" name="format" defaultValue={format ?? ""} className="min-h-11 w-40 rounded-md border bg-background px-3">
            <option value="">All formats (combined)</option>
            {PUBLIC_LEADERBOARD_FORMATS.map(f => <option key={f} value={f}>{publicLeaderboardFormatLabel(f)}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="minimum-innings" className="block text-sm font-medium">Minimum innings</label>
          <input id="minimum-innings" name="minimumInnings" type="number" min={0} max={PUBLIC_LEADERBOARD_MAX_MINIMUM} step={1} defaultValue={parsed.success ? parsed.data.minimumInnings : 0} className="min-h-11 w-32 rounded-md border bg-background px-3" />
        </div>
        <div className="space-y-1">
          <label htmlFor="minimum-balls" className="block text-sm font-medium">Minimum balls</label>
          <input id="minimum-balls" name="minimumBalls" type="number" min={0} max={PUBLIC_LEADERBOARD_MAX_MINIMUM} step={1} defaultValue={parsed.success ? parsed.data.minimumBalls : 0} className="min-h-11 w-32 rounded-md border bg-background px-3" />
        </div>
        <div className="space-y-1">
          <label htmlFor="minimum-matches" className="block text-sm font-medium">Minimum matches</label>
          <input id="minimum-matches" name="minimumMatches" type="number" min={0} max={PUBLIC_LEADERBOARD_MAX_MINIMUM} step={1} defaultValue={parsed.success ? parsed.data.minimumMatches : 0} className="min-h-11 w-32 rounded-md border bg-background px-3" />
        </div>
        <button type="submit" className="min-h-11 rounded-md bg-primary px-4 text-primary-foreground">Apply qualification</button>
        <a href="/leaderboards" className="inline-flex min-h-11 items-center underline">Reset filters</a>
      </form>
      <p className="text-sm text-muted-foreground">Minimums apply to innings batted / balls faced for batting, and innings bowled / balls bowled for bowling. Fielding is qualified on matches played with a recorded fielding scorecard, ranked by dismissals (catches + run-outs + stumpings); minimum balls and innings do not apply to it. Zero means no minimum. User-selected filters do not set league award eligibility.</p>
      {!parsed.success ? <p role="alert" className="text-destructive">Enter whole-number minimums from 0 to 10,000 and a valid match format. Repeated or invalid filter values are not accepted.</p> : <>
      <p className="text-sm">Qualification{formatLabel ? ` (${formatLabel})` : ""}: at least {parsed.data.minimumInnings} innings and {parsed.data.minimumBalls} balls for batting/bowling, and {parsed.data.minimumMatches} matches for fielding. Top 10 per category.</p>
      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle>Top Run Scorers{formatLabel ? ` — ${formatLabel}` : ""}</CardTitle></CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <caption className="sr-only">Qualified published league batting totals{formatLabel ? `, ${formatLabel} format only` : ""}</caption>
              <thead><tr><th scope="col" className="text-left">Rank</th><th scope="col" className="text-left">Player</th><th scope="col" className="text-right">Runs</th></tr></thead>
              <tbody>
                {topRuns.map((r, i) => (
                  <tr key={r.playerId} className="border-b last:border-0">
                    <td className="py-2 w-6 text-muted-foreground">{i + 1}</td>
                    <td className="py-2 font-medium">{r.playerName}{r.playerVerified && (
                      <span className="ml-1 text-primary" aria-label="(verified account)" title="Roster entry linked to an active player account">✓</span>
                    )}</td>
                    <td className="py-2 text-right font-semibold tabular-nums">{r.total}</td>
                  </tr>
                ))}
                {topRuns.length === 0 && <tr><td colSpan={3} className="py-4 text-center text-muted-foreground">No published stats meet these minimums.</td></tr>}
              </tbody>
            </table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Top Wicket Takers{formatLabel ? ` — ${formatLabel}` : ""}</CardTitle></CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <caption className="sr-only">Qualified published league bowling totals{formatLabel ? `, ${formatLabel} format only` : ""}</caption>
              <thead><tr><th scope="col" className="text-left">Rank</th><th scope="col" className="text-left">Player</th><th scope="col" className="text-right">Wickets</th></tr></thead>
              <tbody>
                {topWickets.map((r, i) => (
                  <tr key={r.playerId} className="border-b last:border-0">
                    <td className="py-2 w-6 text-muted-foreground">{i + 1}</td>
                    <td className="py-2 font-medium">{r.playerName}{r.playerVerified && (
                      <span className="ml-1 text-primary" aria-label="(verified account)" title="Roster entry linked to an active player account">✓</span>
                    )}</td>
                    <td className="py-2 text-right font-semibold tabular-nums">{r.total}</td>
                  </tr>
                ))}
                {topWickets.length === 0 && <tr><td colSpan={3} className="py-4 text-center text-muted-foreground">No published stats meet these minimums.</td></tr>}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader><CardTitle>Top Fielders{formatLabel ? ` — ${formatLabel}` : ""}</CardTitle></CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <caption className="sr-only">Qualified published league fielding dismissals{formatLabel ? `, ${formatLabel} format only` : ""}</caption>
            <thead><tr><th scope="col" className="text-left">Rank</th><th scope="col" className="text-left">Player</th><th scope="col" className="text-right">Dismissals</th></tr></thead>
            <tbody>
              {topFielders.map((r, i) => (
                <tr key={r.playerId} className="border-b last:border-0">
                  <td className="py-2 w-6 text-muted-foreground">{i + 1}</td>
                  <td className="py-2 font-medium">{r.playerName}{r.playerVerified && (
                    <span className="ml-1 text-primary" aria-label="(verified account)" title="Roster entry linked to an active player account">✓</span>
                  )}</td>
                  <td className="py-2 text-right font-semibold tabular-nums">{r.total}</td>
                </tr>
              ))}
              {topFielders.length === 0 && <tr><td colSpan={3} className="py-4 text-center text-muted-foreground">No published stats meet these minimums.</td></tr>}
            </tbody>
          </table>
        </CardContent>
      </Card>
      </>}
    </div>
  )
}
