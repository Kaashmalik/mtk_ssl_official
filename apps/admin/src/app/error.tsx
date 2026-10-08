'use client';

import { useEffect } from 'react';
import { Button } from '@mtk/ui';
import * as Sentry from '@sentry/nextjs';

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Report every uncaught admin route error to Sentry. Tag it so the
    // Sentry dashboard can filter admin errors separately from web errors.
    Sentry.captureException(error, {
      level: 'error',
      tags: { source: 'admin-route-error-boundary' },
      extra: { digest: error.digest },
    });
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 text-center">
      <div className="max-w-md space-y-6">
        <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <svg
            className="h-8 w-8"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
          Something went wrong
        </h1>
        <p className="text-muted-foreground">
          An error occurred in the administration dashboard. If the problem persists, please contact support.
        </p>
        <div className="rounded-lg bg-muted p-4 text-left font-mono text-sm overflow-x-auto max-w-full">
          <p className="text-destructive font-semibold">{error.name || 'Error'}:</p>
          <p className="text-foreground mt-1 whitespace-pre-wrap">{error.message || 'Unknown error occurred.'}</p>
          {error.digest && (
            <p className="text-muted-foreground mt-2 text-xs">Digest: {error.digest}</p>
          )}
        </div>
        <div className="flex justify-center gap-4">
          <Button onClick={reset} size="lg" className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold">
            Try again
          </Button>
          <Button onClick={() => window.location.href = '/'} variant="outline" size="lg">
            Go back home
          </Button>
        </div>
      </div>
    </div>
  );
}
