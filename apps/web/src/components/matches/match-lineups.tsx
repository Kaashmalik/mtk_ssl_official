/**
 * Batch 137: the match centre's announced playing XIs — a presentational
 * card over the fail-closed `buildMatchLineups` fold (which reads nothing
 * and invents nothing). A complete declaration renders as the numbered
 * batting sheet with the designated keeper marked; a side without one
 * reads "No XI announced yet" instead of an empty shell; the league's
 * declared-but-unapproved state says so; and the disclosure about
 * substitutions rides with the sheet, always.
 */

import * as React from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@mtk/ui/components/ui/card"
import { LINEUP_DISCLOSURE, type MatchLineups } from "@/lib/match-lineups"

function WicketKeeperMark() {
  return (
    <span
      title="Wicketkeeper"
      aria-label="wicketkeeper"
      className="inline-flex items-center rounded bg-muted px-1 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground"
    >
      wk
    </span>
  )
}

function SideSheet({ teamName, side }: { teamName: string; side: MatchLineups["a"] }) {
  return (
    <div>
      <p className="text-sm font-medium mb-1">{teamName}</p>
      {side ? (
        <ol className="text-sm space-y-0.5">
          {side.players.map((p, i) => (
            <li key={i} className="flex items-center gap-2">
              <span className="text-muted-foreground text-xs tabular-nums w-5 text-end" aria-hidden="true">
                {i + 1}.
              </span>
              <span>{p.name}</span>
              {p.wicketkeeper && <WicketKeeperMark />}
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-xs text-muted-foreground">No XI announced yet.</p>
      )}
    </div>
  )
}

export function MatchLineupsCard({
  lineups,
  teamAName,
  teamBName,
}: {
  lineups: MatchLineups | null
  teamAName: string
  teamBName: string
}) {
  if (!lineups || (!lineups.a && !lineups.b)) return null
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">Playing XIs</CardTitle>
        {lineups.awaitingApproval && (
          <p className="text-xs text-muted-foreground mt-1" data-testid="lineups-pending">
            Declared — awaiting official approval.
          </p>
        )}
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 sm:grid-cols-2">
          <SideSheet teamName={teamAName} side={lineups.a} />
          <SideSheet teamName={teamBName} side={lineups.b} />
        </div>
        <p className="text-xs text-muted-foreground mt-3">{LINEUP_DISCLOSURE}</p>
      </CardContent>
    </Card>
  )
}
