"use client"

import { RouteErrorBoundary } from "@/components/shared/route-error-boundary"

export default function HallOfFameError({
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
      title="Hall of fame error"
      description="The hall of fame could not be loaded right now."
      homeHref="/"
      homeLabel="Home"
      logTag="hall-of-fame-error"
    />
  )
}
