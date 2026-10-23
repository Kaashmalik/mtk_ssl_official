import { Card, CardContent, CardHeader, CardTitle } from "@mtk/ui/components/ui/card"
import type { TournamentLeadersData, TournamentLeaderRow } from "@/lib/tournament-leaders"

/**
 * Batch 124: the "Most Runs / Most Wickets" tables on the public tournament
 * page, mirroring the public leaderboards page's honest markup: sr-only
 * captions, rank + player + total columns, tabular numbers, and the verified
 * check-mark carrying the same title/aria text. No rows → the page renders
 * no card at all (the builder returns null before this ever mounts).
 */

function LeadersTable({
  title,
  caption,
  metricLabel,
  rows,
}: {
  title: string
  caption: string
  metricLabel: string
  rows: TournamentLeaderRow[]
}) {
  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent>
        <table className="w-full text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              <th scope="col" className="text-left">Rank</th>
              <th scope="col" className="text-left">Player</th>
              <th scope="col" className="text-right">{metricLabel}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.playerId} className="border-b last:border-0">
                <td className="py-2 w-6 text-muted-foreground">{r.rank}</td>
                <td className="py-2 font-medium">
                  {r.playerName}
                  {r.playerVerified && (
                    <span className="ml-1 text-primary" aria-label="(verified account)" title="Roster entry linked to an active player account">✓</span>
                  )}
                </td>
                <td className="py-2 text-right font-semibold tabular-nums">{r.total}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={3} className="py-4 text-center text-muted-foreground">No published stats for this competition yet.</td></tr>
            )}
          </tbody>
        </table>
      </CardContent>
    </Card>
  )
}

export function TournamentLeaders({ data }: { data: TournamentLeadersData }) {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <LeadersTable
        title="Most Runs"
        caption="Published batting totals for this competition"
        metricLabel="Runs"
        rows={data.batting}
      />
      <LeadersTable
        title="Most Wickets"
        caption="Published bowling totals for this competition"
        metricLabel="Wickets"
        rows={data.bowling}
      />
    </div>
  )
}
