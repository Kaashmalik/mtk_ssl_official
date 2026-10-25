"use client";

/**
 * Client-error beacon (diagnostic).
 *
 * Sentry's DSN is not configured in this environment, so `captureException`
 * in the error boundaries is a silent no-op and a rendered "team has been
 * notified" claim is false. Until a DSN exists, boundaries report through
 * this beacon: a fire-and-forget POST that the server logs to its runtime
 * output (visible in `vercel logs`), which is the one diagnostic channel
 * that is always on.
 *
 * Best-effort by design: it never throws, never blocks, and silently gives
 * up when the endpoint or network is unavailable.
 */
export function reportClientError(
  source: string,
  error: Error & { digest?: string },
): void {
  if (typeof window === "undefined") return;

  const payload = {
    source,
    message: error.message,
    stack: typeof error.stack === "string" ? error.stack.slice(0, 4000) : null,
    digest: error.digest ?? null,
    path: window.location.pathname,
  };

  try {
    void fetch("/api/client-errors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    /* diagnostics must never become a second failure */
  }
}
