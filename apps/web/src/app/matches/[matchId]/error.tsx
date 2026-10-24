"use client"

import { RouteErrorBoundary } from "@/components/shared/route-error-boundary"

export default function MatchDetailError({
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
      title="Match page error"
      description="This match page could not be loaded. The scorecard data for this link failed to come up."
      homeHref="/"
      homeLabel="Home"
      logTag="match-detail-error"
    />
  )
}
