"use client"

import { RouteErrorBoundary } from "@/components/shared/route-error-boundary"

export default function LeaderboardsError({
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
      title="Leaderboards error"
      description="The leaderboards could not be loaded right now."
      homeHref="/"
      homeLabel="Home"
      logTag="leaderboards-error"
    />
  )
}
