"use client"

import { RouteErrorBoundary } from "@/components/shared/route-error-boundary"

/**
 * Batch 148: segment boundary for /dashboard/matches/[id] — the page's way
 * home is /dashboard, the copy names THIS page, and errors are reported to
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
      title="Match error"
      description="This match could not be loaded right now."
      homeHref="/dashboard"
      homeLabel="Dashboard"
      logTag="dashboard-matches-id-error"
    />
  )
}
