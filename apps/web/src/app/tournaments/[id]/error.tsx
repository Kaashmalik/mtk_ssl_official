"use client"

import { RouteErrorBoundary } from "@/components/shared/route-error-boundary"

export default function TournamentDetailError({
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
      title="Tournament page error"
      description="This tournament page could not be loaded. Its standings and fixtures failed to come up."
      homeHref="/tournaments"
      homeLabel="All tournaments"
      logTag="tournament-detail-error"
    />
  )
}
