"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { toast } from "sonner"
import { Button } from "@mtk/ui/components/ui/button"
import { Label } from "@mtk/ui/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@mtk/ui/components/ui/select"
import { Card, CardContent, CardHeader, CardTitle } from "@mtk/ui/components/ui/card"
import { Loader2, Play, Flag, Trophy } from "lucide-react"
import { setTossResult, startMatch, endMatch } from "@/app/actions/matches"

interface MatchLifecycleControlsProps {
  matchId: string
  status: string
  teamA: { id: string; name: string }
  teamB: { id: string; name: string }
  players?: { id: string; name: string }[]
}

export function MatchLifecycleControls({
  matchId,
  status,
  teamA,
  teamB,
  players = [],
}: MatchLifecycleControlsProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [tossWinnerId, setTossWinnerId] = useState(teamA.id)
  const [tossDecision, setTossDecision] = useState<"bat" | "bowl">("bat")
  const [winnerId, setWinnerId] = useState<string>(teamA.id)
  const [manOfMatchId, setManOfMatchId] = useState<string>("")

  const run = (fn: () => Promise<unknown>, ok: string) => {
    startTransition(async () => {
      try {
        await fn()
        toast.success(ok)
        router.refresh()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Action failed")
      }
    })
  }

  if (status === "completed" || status === "abandoned" || status === "cancelled") {
    return null
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Match Controls</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {(status === "scheduled" || status === "toss") && (
          <div className="grid gap-3 sm:grid-cols-3 items-end">
            <div>
              <Label>Toss winner</Label>
              <Select value={tossWinnerId} onValueChange={setTossWinnerId}>
                <SelectTrigger className="mt-1.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={teamA.id}>{teamA.name}</SelectItem>
                  <SelectItem value={teamB.id}>{teamB.name}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Decision</Label>
              <Select
                value={tossDecision}
                onValueChange={(v) => setTossDecision(v as "bat" | "bowl")}
              >
                <SelectTrigger className="mt-1.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="bat">Bat</SelectItem>
                  <SelectItem value="bowl">Bowl</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              disabled={isPending}
              onClick={() =>
                run(
                  () => setTossResult(matchId, tossWinnerId, tossDecision),
                  "Toss recorded",
                )
              }
            >
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Flag className="h-4 w-4 mr-2" />}
              Set Toss
            </Button>
          </div>
        )}

        {(status === "scheduled" || status === "toss") && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="gradient-shine"
              disabled={isPending}
              onClick={() => run(() => startMatch(matchId), "Match started")}
            >
              <Play className="h-4 w-4 mr-2" />
              Start Match
            </Button>
            <Link href={`/matches/${matchId}/scoring`}>
              <Button variant="outline">Open Live Scoring</Button>
            </Link>
          </div>
        )}

        {status === "live" && (
          <div className="grid gap-3 sm:grid-cols-3 items-end">
            <div className="sm:col-span-1">
              <Label>Winner</Label>
              <Select value={winnerId} onValueChange={setWinnerId}>
                <SelectTrigger className="mt-1.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={teamA.id}>{teamA.name}</SelectItem>
                  <SelectItem value={teamB.id}>{teamB.name}</SelectItem>
                  <SelectItem value="draw">Draw / No result</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {players.length > 0 && (
              <div className="sm:col-span-1">
                <Label>Player of the Match</Label>
                <Select value={manOfMatchId} onValueChange={setManOfMatchId}>
                  <SelectTrigger className="mt-1.5">
                    <SelectValue placeholder="Select player" />
                  </SelectTrigger>
                  <SelectContent>
                    {players.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <Button
              disabled={isPending}
              onClick={() =>
                run(
                  () =>
                    endMatch(
                      matchId,
                      winnerId === "draw" ? null : winnerId,
                      winnerId === "draw"
                        ? "Match ended with no result"
                        : `${winnerId === teamA.id ? teamA.name : teamB.name} won`,
                      manOfMatchId || null,
                    ),
                  "Match completed",
                )
              }
            >
              <Trophy className="h-4 w-4 mr-2" />
              End Match
            </Button>
            <Link href={`/matches/${matchId}/scoring`}>
              <Button variant="outline" className="w-full">
                Continue Scoring
              </Button>
            </Link>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
