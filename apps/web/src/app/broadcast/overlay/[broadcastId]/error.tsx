"use client"

import { RouteErrorBoundary } from "@/components/shared/route-error-boundary"

/**
 * Batch 148: segment boundary for /broadcast/overlay/[broadcastId] — the page's way
 * home is /, the copy names THIS page, and errors are reported to
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
      title="Overlay error"
      description="This broadcast overlay could not be loaded. Reopen it from the broadcast panel."
      homeHref="/"
      homeLabel="Home"
      logTag="broadcast-overlay-broadcastId-error"
    />
  )
}
