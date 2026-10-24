"use client"

import { RouteErrorBoundary } from "@/components/shared/route-error-boundary"

/**
 * Batch 145: the dashboard ROOT boundary. Every dashboard sub-segment got
 * its own boundary in earlier batches, but any segment without one (and
 * any layout-level failure) fell through to the PUBLIC root page — an
 * organizer mid-scoring would leave the app shell entirely. This keeps
 * the failure inside the dashboard with an honest way back.
 */
export default function DashboardError({
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
      title="Dashboard error"
      description="This part of the dashboard could not be loaded right now."
      homeHref="/dashboard"
      homeLabel="Dashboard"
      logTag="dashboard-error"
    />
  )
}
