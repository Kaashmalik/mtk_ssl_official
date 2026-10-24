"use client"

import { RouteErrorBoundary } from "@/components/shared/route-error-boundary"

export default function TournamentsError({
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
      title="Tournaments list error"
      description="The public tournament list could not be loaded right now."
      homeHref="/"
      homeLabel="Home"
      logTag="tournaments-error"
    />
  )
}
