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

export function PointsTable({ rows, hasGroups = false }: { rows: StandingsRow[]; hasGroups?: boolean }) {
  return (
    <Card>
      <CardHeader><CardTitle>Points Table</CardTitle></CardHeader>
      <CardContent className="px-0 sm:px-6">
        {/* Narrow screens: let the table scroll rather than push the page wide. */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[24rem]">
            <thead>
              {/* Batch 138 (standings sweep): column semantics the group tables
                  already had, plus the engine's order rendered as positions. */}
              <tr className="border-b text-muted-foreground text-xs">
                <th scope="col" className="py-2 pl-6 text-center font-medium" aria-label="Position">#</th>
                <th scope="col" className="py-2 pl-2 text-left font-medium">Team</th>
                <th scope="col" title="Played" className="py-2 px-2 text-center font-medium">P</th>
                <th scope="col" title="Won" className="py-2 px-2 text-center font-medium">W</th>
                <th scope="col" title="Lost" className="py-2 px-2 text-center font-medium">L</th>
                <th scope="col" title="Points" className="py-2 px-2 text-center font-medium">Pts</th>
                <th scope="col" title="Net run rate" className="py-2 pr-6 text-center font-medium">NRR</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s, position) => (
                <tr key={s.teamId} className="border-b last:border-0">
                  <td className="py-2 pl-6 text-center tabular-nums text-muted-foreground" aria-label={`Position ${position + 1}`}>{position + 1}</td>
                  <th scope="row" className="py-2 pl-2 text-left font-medium max-w-[10rem] truncate" title={s.name}>{s.name}</th>
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
        {/* Batch 138: the reciprocal covering note — the group tables explain
            the tournament-wide table; this explains the groups. It renders
            ONLY where the page actually shows both (prop-driven; the
            dashboard twin mounts group standings without this table). */}
        {hasGroups && (
          <p className="text-xs text-muted-foreground mt-2 px-6">
            Group-labelled fixtures also count toward their group&apos;s table above; this table covers every fixture in the competition.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
