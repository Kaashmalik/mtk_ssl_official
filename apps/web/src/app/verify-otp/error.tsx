"use client"

import { RouteErrorBoundary } from "@/components/shared/route-error-boundary"

/**
 * Batch 148: segment boundary for /verify-otp — the page's way
 * home is /sign-in, the copy names THIS page, and errors are reported to
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
      title="Verification error"
      description="Verification could not continue right now."
      homeHref="/sign-in"
      homeLabel="Back to sign-in"
      logTag="verify-otp-error"
    />
  )
}
