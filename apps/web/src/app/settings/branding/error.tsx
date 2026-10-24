"use client"

import { RouteErrorBoundary } from "@/components/shared/route-error-boundary"

/**
 * Batch 148: segment boundary for /settings/branding — the page's way
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
      title="Branding error"
      description="Branding settings could not be loaded right now."
      homeHref="/"
      homeLabel="Home"
      logTag="settings-branding-error"
    />
  )
}
