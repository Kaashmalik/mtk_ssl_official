"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@mtk/ui/components/ui/card"

/**
 * FAN-04 (B163): the lazy AI match summary card. The server page ships this
 * ONLY when MATCH_SUMMARY_AI_READY is enabled — an ungated deployment never
 * loads the client code at all, so no hidden request exists.
 *
 * Render rules, pinned:
 * - The summary renders ONLY with its AI/derived label AND the
 *   never-a-fabricated-narrative notice, together, always.
 * - A failed/unavailable fetch renders NOTHING: an honest absence, never an
 *   error box pretending a summary was withheld.
 */
export function AiSummaryCard({ matchId }: { matchId: string }) {
  const [state, setState] = useState<{ summary: string; source: "ai" | "derived" } | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/matches/${matchId}/ai-summary`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { summary: string | null; source: "ai" | "derived" } | null) => {
        if (cancelled) return
        if (data && typeof data.summary === "string" && data.summary.length > 0) {
          setState({ summary: data.summary, source: data.source === "ai" ? "ai" : "derived" })
        }
      })
      .catch(() => {}) // honest absence
    return () => { cancelled = true }
  }, [matchId])

  if (!state) return null

  return (
    <Card data-testid="match-ai-summary">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          {state.source === "ai" ? (
            <span className="text-xs font-semibold uppercase tracking-wide border border-amber-500/60 text-amber-700 dark:text-amber-400 rounded px-1.5 py-0.5">
              AI-generated
            </span>
          ) : (
            <span className="text-xs font-semibold uppercase tracking-wide border border-muted-foreground/40 text-muted-foreground rounded px-1.5 py-0.5">
              Derived
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm">{state.summary}</p>
        <p className="text-xs text-muted-foreground mt-2">
          Rendered from the recorded match facts only — not an official record,
          never a substitute for the scorecard, and it never changes official
          scores.
        </p>
      </CardContent>
    </Card>
  )
}
