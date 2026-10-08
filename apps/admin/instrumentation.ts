/**
 * Next.js instrumentation hook for the admin app — runs once per runtime.
 *
 * Mirrors the web app's instrumentation: structured logging always on,
 * Sentry initialised in production only.
 *
 * NOTE: Reads `SENTRY_DSN` (server-only) — NOT `NEXT_PUBLIC_SENTRY_DSN`.
 * See apps/web/instrumentation.ts for the rationale on this env-var name.
 */

export async function register(): Promise<void> {
  if (typeof process !== "undefined") {
    process.env.SERVICE_NAME = process.env.SERVICE_NAME || "admin";
  }

  if (process.env.NODE_ENV !== "production") {
    return;
  }

  const dsn =
    process.env.SENTRY_DSN ||
    process.env.NEXT_PUBLIC_SENTRY_DSN;

  if (!dsn) {
    console.warn(
      "[instrumentation:admin] SENTRY_DSN is not set — error monitoring is DISABLED for this deployment."
    );
    return;
  }

  const sentryOptions = {
    dsn,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
    environment:
      process.env.SENTRY_ENVIRONMENT ||
      process.env.APP_ENV ||
      process.env.NODE_ENV,
    release: process.env.SENTRY_RELEASE || undefined,
  };

  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { init } = await import("@sentry/nextjs");
    init(sentryOptions);
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    const { init } = await import("@sentry/nextjs");
    init(sentryOptions);
  }
}
