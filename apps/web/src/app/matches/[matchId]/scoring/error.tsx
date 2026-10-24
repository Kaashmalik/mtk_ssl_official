"use client"

import * as React from "react"
import { useEffect } from "react"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@mtk/ui/components/ui/card"
import { Button } from "@mtk/ui/components/ui/button"
import { AlertTriangle, RotateCcw, ClipboardList } from "lucide-react"

/**
 * Batch 143 (resilience): the live-scoring segment had loading.tsx but NO
 * error boundary — any render error (a failed lazy chart chunk on a weak
 * connection, a drifted snapshot shape) escaped to the ROOT error page and
 * replaced the entire scorer mid-match. This boundary keeps recovery one
 * tap away and states the scorer's real situation honestly: deliveries
 * already recorded through the canonical path are on the server; only the
 * current unsaved screen state needs re-checking. No invented reassurance
 * about unsaved local work — Batch 142's integrity boundary resets any
 * state it cannot vouch for, and this card says to glance at the tablet,
 * not that everything is fine.
 */
export default function ScoringMatchError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("[Match Scoring Error]", error)
  }, [error])

  return (
    <div className="flex items-center justify-center min-h-[400px] p-4" role="alert">
      <Card className="max-w-md w-full border-destructive/20 shadow-lg">
        <CardHeader className="text-center pb-2">
          <div className="mx-auto p-3 rounded-2xl bg-destructive/10 w-fit mb-3">
            <AlertTriangle className="h-6 w-6 text-destructive" />
          </div>
          <CardTitle className="text-lg font-bold">The scoring screen hit a problem</CardTitle>
        </CardHeader>
        <CardContent className="text-center space-y-4">
          <p className="text-sm text-muted-foreground">
            {error.message || "An unexpected error interrupted the scoring screen."}
          </p>
          <p className="text-sm text-muted-foreground">
            Deliveries already recorded are safe on the server. Before re-entering anything, confirm
            the last delivery on this screen against the scorecard.
          </p>
          {error.digest && (
            <p className="text-xs text-muted-foreground/60 font-mono">Error ID: {error.digest}</p>
          )}
          <div className="flex items-center justify-center gap-3 pt-2">
            <Button onClick={reset} className="gap-2">
              <RotateCcw className="h-4 w-4" />
              Try again
            </Button>
            <Link href="/dashboard/scoring">
              <Button variant="outline" className="gap-2">
                <ClipboardList className="h-4 w-4" />
                Scoring console
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
