"use client"

import { useEffect } from "react"
import * as Sentry from "@sentry/nextjs"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@mtk/ui/components/ui/card"
import { Button } from "@mtk/ui/components/ui/button"
import { AlertTriangle, RotateCcw } from "lucide-react"

/**
 * Batch 145: THE shared route error boundary. Batch 143 gave the scoring
 * segment a hand-rolled boundary and every other public segment still fell
 * through to the generic root page — losing segment context, navigation,
 * and (on the root page) rendering an unstyled fallback that claims the
 * team "has been notified" whether or not anything was reported.
 *
 * This component makes that contract true everywhere it renders: the error
 * IS reported to Sentry with the segment as a tag, the digest is shown for
 * support correlation (the stable identifier — the raw `error.message` is
 * deliberately NOT rendered, because it can carry query internals), and
 * the way forward is honest: retry, or go to the segment home.
 */

export function RouteErrorBoundary({
  error,
  reset,
  title,
  description,
  homeHref,
  homeLabel,
  logTag,
}: {
  error: Error & { digest?: string }
  reset: () => void
  /** Segment-specific title, e.g. "Tournament page error". */
  title: string
  /** Honest one-liner about what failed to load. */
  description: string
  /** Where the segment's home link points (list page / dashboard root). */
  homeHref: string
  homeLabel: string
  /** Sentry + console tag, e.g. "tournaments-error". */
  logTag: string
}) {
  useEffect(() => {
    console.error(`[${logTag}]`, error)
    Sentry.captureException(error, {
      level: "error",
      tags: { source: "route-error-boundary", segment: logTag },
      extra: { digest: error.digest },
    })
  }, [error, logTag])

  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <Card className="max-w-md w-full glass-panel-subtle border-destructive/20 shadow-lg">
        <CardHeader className="text-center pb-2">
          <div className="mx-auto p-3 rounded-2xl bg-destructive/10 w-fit mb-3">
            <AlertTriangle className="h-6 w-6 text-destructive" />
          </div>
          <CardTitle className="text-lg font-bold">{title}</CardTitle>
        </CardHeader>
        <CardContent className="text-center space-y-4">
          <p className="text-sm text-muted-foreground">{description}</p>
          {error.digest && (
            <p className="text-xs text-muted-foreground/60 font-mono">Error ID: {error.digest}</p>
          )}
          <div className="flex items-center justify-center gap-3 pt-2">
            <Button onClick={reset} variant="default" className="gap-2">
              <RotateCcw className="h-4 w-4" />
              Try Again
            </Button>
            <Link href={homeHref}>
              <Button variant="outline" className="gap-2">
                {homeLabel}
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
