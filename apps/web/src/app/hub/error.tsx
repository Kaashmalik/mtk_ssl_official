"use client"

import { RouteErrorBoundary } from "@/components/shared/route-error-boundary"

export default function HubError({
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
      title="Hub error"
      description="The public hub could not be loaded right now."
      homeHref="/"
      homeLabel="Home"
      logTag="hub-error"
    />
  )
}
