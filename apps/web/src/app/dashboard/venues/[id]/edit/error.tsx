"use client"

import { RouteErrorBoundary } from "@/components/shared/route-error-boundary"

/**
 * Batch 148: segment boundary for /dashboard/venues/[id]/edit — the page's way
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
      title="Venue editor error"
      description="The venue editor could not be loaded right now."
      homeHref="/dashboard"
      homeLabel="Dashboard"
      logTag="dashboard-venues-id-edit-error"
    />
  )
}
