import { Card, CardContent } from "@mtk/ui/components/ui/card"
import { Badge } from "@mtk/ui/components/ui/badge"
import Link from "next/link"

export interface BracketMatch {
  id: string
  round: number
  label: string
  teamA: { name: string; score?: number | null } | null
  teamB: { name: string; score?: number | null } | null
  winnerId: string | null
  teamAId: string | null
  teamBId: string | null
  status: string
  matchNumber: number | null
  isLive: boolean
}

const roundNames = ["Round 1", "Quarter Final", "Semi Final", "Final"]

/**
 * Knockout bracket rendered from flat match rows.
 * Columns are rounds; a match advances visually via the winner badge.
 * Horizontally scrollable so it stays usable on mobile.
 */
export function KnockoutBracket({ matches }: { matches: BracketMatch[] }) {
  if (matches.length === 0) return null

  const maxRound = Math.max(...matches.map((m) => m.round))
  const rounds: BracketMatch[][] = Array.from({ length: maxRound + 1 }, (_, r) =>
    matches.filter((m) => m.round === r).sort((a, b) => (a.matchNumber ?? 0) - (b.matchNumber ?? 0)),
  )

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="overflow-x-auto pb-2">
          <div className="flex gap-6 min-w-max">
            {rounds.map((roundMatches, r) => (
              <div key={r} className="flex flex-col gap-4 justify-around">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground text-center">
                  {roundNames[r] ?? `Round ${r + 1}`}
                </p>
                {roundMatches.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-8">TBD</p>
                )}
                {roundMatches.map((m) => {
                  const row = (side: "A" | "B") => {
                    const team = side === "A" ? m.teamA : m.teamB
                    const teamId = side === "A" ? m.teamAId : m.teamBId
                    const isWinner = !!m.winnerId && m.winnerId === teamId
                    const isLoser = !!m.winnerId && m.winnerId !== teamId
                    return (
                      <div
                        key={side}
                        className={`flex items-center justify-between gap-3 rounded px-3 py-2 text-sm min-w-[190px] border ${
                          isWinner
                            ? "border-green-500/40 bg-green-500/10 font-semibold"
                            : isLoser
                              ? "opacity-55 border-border"
                              : "border-border"
                        }`}
                      >
                        <span className="truncate">{team?.name ?? "TBD"}</span>
                        {team?.score != null && (
                          <span className="tabular-nums text-muted-foreground">{team.score}</span>
                        )}
                      </div>
                    )
                  }

                  return (
                    <div key={m.id} className="space-y-0.5">
                      {row("A")}
                      {row("B")}
                      <div className="flex items-center justify-between px-1 pt-1">
                        <Link
                          href={`/matches/${m.id}`}
                          className="text-[11px] text-primary hover:underline"
                        >
                          {m.matchNumber ? `Match ${m.matchNumber}` : "Details"}
                        </Link>
                        {m.isLive ? (
                          <Badge className="bg-red-600 text-white text-[10px]">LIVE</Badge>
                        ) : m.status === "completed" ? (
                          <span className="text-[11px] text-muted-foreground">Final</span>
                        ) : null}
                      </div>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}