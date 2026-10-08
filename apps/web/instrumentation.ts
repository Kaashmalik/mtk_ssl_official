/**
 * Next.js instrumentation hook — runs once per runtime on server boot.
 *
 * Initialises structured logging (always on) and Sentry (production only).
 *
 * IMPORTANT: This file previously read `NEXT_PUBLIC_SENTRY_DSN`, but every
 * env file in the repo defines the variable as `SENTRY_DSN` (no public
 * prefix). As a result Sentry silently initialised with an undefined DSN and
 * never captured anything. We now read `SENTRY_DSN` (correct) and fall back
 * to `NEXT_PUBLIC_SENTRY_DSN` only for backward compatibility with any
 * deployment that happened to use the old name.
 */

export async function register(): Promise<void> {
  // Always set the service tag so log lines are identifiable per-app.
  if (typeof process !== "undefined") {
    process.env.SERVICE_NAME = process.env.SERVICE_NAME || "web";
  }

  // Skip Sentry instrumentation in development to avoid Turbopack
  // module-resolution issues that cause "(void 0) is not a function"
  // errors on client-side JSX elements.
  if (process.env.NODE_ENV !== "production") {
    return;
  }

  const dsn =
    process.env.SENTRY_DSN ||
    process.env.NEXT_PUBLIC_SENTRY_DSN;

  if (!dsn) {
    // No DSN configured — log loudly once at boot so ops knows Sentry is off.
    // We use console here (not the logger) because this runs before the
    // logger is imported, and we want this line to be impossible to miss.
    console.warn(
      "[instrumentation] SENTRY_DSN is not set — error monitoring is DISABLED for this deployment."
    );
    return;
  }

  const sentryOptions = {
    dsn,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
    // Prefer explicit staging/prod split over raw NODE_ENV.
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
