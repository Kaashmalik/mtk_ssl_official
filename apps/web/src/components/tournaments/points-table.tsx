import React from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@mtk/ui/components/ui/card"
import { formatNetRunRate, type StandingsRow } from "@/lib/standings"

/**
 * Batch 132: the tournament-wide points table, extracted from the public
 * page so it is directly pinnable, and — the actual fix — SHOWING the NRR
 * column. The versioned standings engine computes NRR and sorts by it as a
 * tiebreak; a reader whose team sits below another on equal points must be
 * able to see why. Same convention as the group tables: formatted NRR when
 * there is complete innings evidence on both sides, an honest em-dash
 * until then (never a fabricated 0.00). Long club names stay width-
 * constrained and truncated (title attribute intact) so the numeric
 * columns a reader scans never squeeze out.
 */

export function PointsTable({ rows }: { rows: StandingsRow[] }) {
  return (
    <Card>
      <CardHeader><CardTitle>Points Table</CardTitle></CardHeader>
      <CardContent className="px-0 sm:px-6">
        {/* Narrow screens: let the table scroll rather than push the page wide. */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[24rem]">
            <thead>
              <tr className="border-b text-muted-foreground text-xs">
                <th className="py-2 pl-6 text-left font-medium">Team</th>
                <th className="py-2 px-2 text-center font-medium">P</th>
                <th className="py-2 px-2 text-center font-medium">W</th>
                <th className="py-2 px-2 text-center font-medium">L</th>
                <th className="py-2 px-2 text-center font-medium">Pts</th>
                <th className="py-2 pr-6 text-center font-medium">NRR</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.teamId} className="border-b last:border-0">
                  <td className="py-2 pl-6 font-medium max-w-[10rem] truncate" title={s.name}>{s.name}</td>
                  <td className="py-2 px-2 text-center tabular-nums">{s.played}</td>
                  <td className="py-2 px-2 text-center tabular-nums">{s.won}</td>
                  <td className="py-2 px-2 text-center tabular-nums">{s.lost}</td>
                  <td className="py-2 px-2 text-center font-semibold tabular-nums">{s.points}</td>
                  <td className="py-2 pr-6 text-center tabular-nums">{s.hasNetRunRate ? formatNetRunRate(s.netRunRate) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}
