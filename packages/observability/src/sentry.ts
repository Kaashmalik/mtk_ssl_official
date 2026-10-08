/**
 * Sentry integration wrapper.
 *
 * Provides a single, app-agnostic API for error reporting so call sites
 * don't need to know whether Sentry is installed. When `@sentry/nextjs` is
 * present AND the SDK has been initialised (a DSN was configured), errors are
 * forwarded to Sentry. Otherwise they fall back to the structured logger.
 *
 * This lets the same call site (`captureError(err, { extra })`) work in:
 *   - web (Sentry installed)
 *   - admin (Sentry to be added)
 *   - marketing / mobile (no Sentry)
 *   - tests (no Sentry)
 *
 * The dynamic import keeps `@sentry/nextjs` out of the module graph for apps
 * that haven't installed it, so it's a true optional peer dependency.
 */

import { logger, type LogContext } from "./logger";

export interface CaptureOptions {
  /** Extra structured context attached to the event. */
  extra?: Record<string, unknown>;
  /** Tags (indexed, filterable in Sentry UI). */
  tags?: Record<string, string | number | boolean>;
  /** Severity hint. Defaults to "error". */
  level?: "info" | "warning" | "error" | "fatal";
  /** Logging context (requestId, tenantId, userId) for the fallback logger. */
  context?: LogContext;
}

let sentryChecked = false;
let sentryAvailable = false;

async function getSentry(): Promise<typeof import("@sentry/nextjs") | null> {
  if (!sentryChecked) {
    try {
      // `require.resolve` would be cleaner but isn't available on Edge; the
      // dynamic import will simply reject if the package is absent.
      await import("@sentry/nextjs");
      sentryAvailable = true;
    } catch {
      sentryAvailable = false;
    }
    sentryChecked = true;
  }
  if (!sentryAvailable) return null;
  try {
    return await import("@sentry/nextjs");
  } catch {
    return null;
  }
}

/**
 * Capture an error/exception. Forwards to Sentry if available, always logs.
 *
 * NEVER throws — reporting failures must not interrupt request handling.
 */
export async function captureError(
  error: unknown,
  opts: CaptureOptions = {}
): Promise<void> {
  // Always log locally first (Sentry delivery is async and may fail).
  const err = error instanceof Error ? error : new Error(String(error));
  const ctxLogger = opts.context ? logger.child(opts.context) : logger;
  ctxLogger.error(err.message, err, opts.extra);

  const Sentry = await getSentry();
  if (!Sentry) return;

  try {
    Sentry.captureException(err, {
      level: opts.level ?? "error",
      extra: opts.extra,
      tags: opts.tags,
    });
  } catch {
    // Sentry capture failure — we already logged above, nothing more to do.
  }
}

/**
 * Capture a message (non-error) event.
 */
export async function captureMessage(
  message: string,
  opts: CaptureOptions = {}
): Promise<void> {
  const ctxLogger = opts.context ? logger.child(opts.context) : logger;
  if (opts.level === "info") ctxLogger.info(message, opts.extra);
  else if (opts.level === "warning") ctxLogger.warn(message, opts.extra);
  else ctxLogger.error(message, opts.extra);

  const Sentry = await getSentry();
  if (!Sentry) return;

  try {
    Sentry.captureMessage(message, {
      level: opts.level ?? "info",
      extra: opts.extra,
      tags: opts.tags,
    });
  } catch {
    // ignore — already logged
  }
}

/**
 * Explicitly flush pending Sentry events. Useful at the end of a serverless
 * function invocation (e.g., Vercel) to ensure events ship before freeze.
 */
export async function flush(timeoutMs = 2000): Promise<void> {
  const Sentry = await getSentry();
  if (!Sentry) return;
  try {
    await Sentry.flush(timeoutMs);
  } catch {
    // ignore
  }
}
