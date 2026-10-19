"use client"

import { useState, useTransition } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@mtk/ui/components/ui/card"
import { saveMyPredictionAction } from "@/app/actions/fan-predictions"
import { PREDICTION_DISCLOSURE } from "@mtk/database/lib/fan-prediction-policy"

/**
 * FAN-04 (Batch 164): the private, no-stakes prediction card — the third
 * sibling beside availability and correction requests on the dashboard
 * match page. Rules, pinned:
 * - The viewer's pick is theirs alone; there is no league-wide pick display
 *   (a pick can never turn into a leaderboard of betting behavior).
 * - Picking through the writer's window gate; the card reflects resulting
 *   state and shows the honest window sentence when closed.
 * - A settled verdict is DERIVED display: it names the official winner and
 *   never fabricates a margin; a void state says "no verdict".
 * - The disclosure line is ALWAYS attached (no stakes, never official).
 */
export interface PredictionView {
  pick: "home" | "away" | null
  windowOpen: boolean
  windowSentence: string
  settled: { verdict: "correct" | "incorrect" | "void"; reason?: string } | null
  resultText: string | null
}

export function MatchPredictionCard({
  matchId,
  teamAName,
  teamBName,
  view,
}: {
  matchId: string
  teamAName: string
  teamBName: string
  view: PredictionView
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [pick, setPick] = useState(view.pick)

  const run = (nextPick: "home" | "away") => {
    setError(null)
    startTransition(async () => {
      try {
        const result = await saveMyPredictionAction({ matchId, pick: nextPick })
        setPick(result.pick)
        setDone(result.changed ? "Pick recorded." : "Already predicted - your pick stands.")
      } catch (err) {
        setError(err instanceof Error ? err.message : "The prediction could not be recorded")
      }
    })
  }

  return (
    <Card data-testid="match-prediction">
      <CardHeader>
        <CardTitle className="text-lg">Who wins?</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {view.settled ? (
          <div className="space-y-1 text-sm">
            <p>
              {view.settled.verdict === "void"
                ? "No verdict: this match ended without a recorded winner."
                : view.settled.verdict === "correct"
                  ? `Your pick was correct: ${pick === "home" ? teamAName : teamBName} won.`
                  : `Your pick did not come in: ${pick === "home" ? teamAName : teamBName} won.`}
            </p>
            {view.resultText && <p className="text-xs text-muted-foreground">Official result: {view.resultText}</p>}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                data-testid="predict-home"
                disabled={pending || !view.windowOpen}
                aria-pressed={pick === "home"}
                onClick={() => run("home")}
                className={`rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${pick === "home" ? "border-primary bg-primary/10" : ""}`}
              >
                {teamAName}
              </button>
              <button
                type="button"
                data-testid="predict-away"
                disabled={pending || !view.windowOpen}
                aria-pressed={pick === "away"}
                onClick={() => run("away")}
                className={`rounded-md border px-3 py-1.5 text-sm font-medium disabled:opacity-50 ${pick === "away" ? "border-primary bg-primary/10" : ""}`}
              >
                {teamBName}
              </button>
            </div>
            {!view.windowOpen && <p className="text-xs text-muted-foreground">{view.windowSentence}</p>}
          </>
        )}
        {done && <p role="status" className="text-xs text-green-700">{done}</p>}
        {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
        <p className="text-xs text-muted-foreground">{PREDICTION_DISCLOSURE}</p>
      </CardContent>
    </Card>
  )
}
