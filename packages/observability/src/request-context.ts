/**
 * Request-scoped context helpers.
 *
 * Each inbound HTTP request gets a `requestId` (reused from the
 * `x-request-id` header if present, otherwise generated). This id is then
 * attached to every structured log line via `getRequestLogger()`, and to
 * Sentry events via `captureError({ context })`.
 *
 * This avoids passing `requestId` through every function signature.
 */

import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { Logger, logger, type LogContext } from "./logger";

export interface RequestContext extends LogContext {
  requestId: string;
  method?: string;
  path?: string;
}

const requestStore = new AsyncLocalStorage<RequestContext>();

function generateRequestId(): string {
  try {
    return randomUUID();
  } catch {
    // Fallback if crypto is unavailable (unlikely on Node ≥ 19 / Edge).
    return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

/**
 * Read or generate the request id from incoming headers.
 * Pass the `Headers` object from a Next.js Request / middleware.
 */
export function resolveRequestId(headers: Headers): string {
  const incoming =
    headers.get("x-request-id") ||
    headers.get("x-correlation-id") ||
    headers.get("request-id");
  if (incoming && incoming.length <= 128) return incoming;
  return generateRequestId();
}

/** Run `fn` with a request context set for the duration of the call. */
export function withRequestContext<T>(
  ctx: RequestContext,
  fn: () => Promise<T>
): Promise<T> {
  return requestStore.run(ctx, fn);
}

/** Get the current request context, or null if outside a request. */
export function getRequestContext(): RequestContext | null {
  return requestStore.getStore() ?? null;
}

/**
 * Get a logger pre-bound to the current request context.
 * Outside a request, returns the global logger.
 */
export function getRequestLogger(): Logger {
  const ctx = getRequestContext();
  return ctx ? logger.child(ctx) : logger;
}
