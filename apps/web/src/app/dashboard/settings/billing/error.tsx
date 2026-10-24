"use client"

import { RouteErrorBoundary } from "@/components/shared/route-error-boundary"

/**
 * Batch 148: segment boundary for /dashboard/settings/billing — the page's way
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
      title="Billing error"
      description="Billing could not be loaded right now."
      homeHref="/dashboard"
      homeLabel="Dashboard"
      logTag="dashboard-settings-billing-error"
    />
  )
}
