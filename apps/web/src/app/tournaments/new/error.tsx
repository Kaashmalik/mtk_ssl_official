"use client"

import { RouteErrorBoundary } from "@/components/shared/route-error-boundary"

/**
 * Batch 148: segment boundary for /tournaments/new — the page's way
 * home is /tournaments, the copy names THIS page, and errors are reported to
 * Sentry with the segment tag (shared component, one honest contract).
 */
export default function SegmentError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <RouteErrorBoundary
      error={error}
      reset={reset}
      title="Tournament creation error"
      description="The tournament creation form could not be loaded right now."
      homeHref="/tournaments"
      homeLabel="All tournaments"
      logTag="tournaments-new-error"
    />
  )
}
