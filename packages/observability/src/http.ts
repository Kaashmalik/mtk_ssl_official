/**
 * HTTP helpers for health endpoints.
 *
 * These produce framework-agnostic `Response` objects so they can be returned
 * directly from a Next.js route handler, an Express handler, or a Hono handler.
 */

import type { HealthStatus } from "./health";

export interface HealthResponse {
  status: HealthStatus;
  checkedAt: string;
  services: Record<string, unknown>;
  /** Commit/revision for quick identification in uptime dashboards. */
  revision?: string;
}

/** HTTP status code for a given rolled-up health status. */
export function statusForHealth(overall: HealthStatus): number {
  // 503 for "down" so load balancers / k8s probes pull the pod out of rotation.
  // 200 for "degraded" (still serving traffic, just with reduced capability).
  switch (overall) {
    case "down":
      return 503;
    case "degraded":
    case "healthy":
    default:
      return 200;
  }
}

/**
 * Build a `Response` from a health result object.
 * `cacheControl` defaults to "no-store" since health is point-in-time.
 */
export function healthResponse(
  result: HealthResponse,
  init?: { cacheControl?: string }
): Response {
  const body = JSON.stringify(result);
  return new Response(body, {
    status: statusForHealth(result.status),
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": init?.cacheControl ?? "no-store",
    },
  });
}

/**
 * Build a JSON error response with the same envelope as success responses.
 */
export function jsonResponse(
  body: unknown,
  init?: { status?: number; cacheControl?: string }
): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": init?.cacheControl ?? "no-store",
    },
  });
}
