import { NextResponse } from "next/server";
import { HealthRegistry, pingPostgres, healthResponse, type HealthResponse } from "@mtk/observability";
import { db } from "@mtk/database";
import { users } from "@mtk/database";
import { captureError, getRequestLogger } from "@mtk/observability";
import { featureReadiness } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * Anonymous health endpoint — no auth required.
 *
 * Used by:
 *   - Kubernetes liveness / readiness probes
 *   - Vercel monitoring
 *   - Uptime bots (BetterUptime, Pingdom, etc.)
 *
 * Returns 200 (healthy / degraded) or 503 (down).
 * The response body contains per-service status and latency so the
 * calling system can make informed decisions.
 */
export async function GET() {
  const log = getRequestLogger();

  const registry = new HealthRegistry();

  // Postgres probe — a lightweight SELECT LIMIT 1 on the users table.
  registry.add({
    name: "postgres",
    critical: true,
    run: () =>
      pingPostgres({
        ping: () => db.select({ id: users.id }).from(users).limit(1),
        degradedAboveMs: 500,
      }),
  });

  // Redis probe — only if REDIS_URL is configured.
  // Dynamic import avoids bundling ioredis in Edge-only contexts.
  registry.add({
    name: "redis",
    critical: false, // Redis is for rate-limiting, not core data — degrade is ok
    run: async () => {
      const url = process.env.REDIS_URL;
      if (!url) {
        return { status: "degraded", message: "Redis not configured" };
      }
      try {
        const { default: Redis } = await import("ioredis");
        const client = new Redis(url, {
          maxRetriesPerRequest: 1,
          lazyConnect: true,
          connectTimeout: 1000,
        });
        const started = Date.now();
        try {
          const result = await client.ping();
          return {
            status: result === "PONG" ? "healthy" : "down",
            latencyMs: Date.now() - started,
            message: result,
          };
        } finally {
          client.disconnect();
        }
      } catch (err) {
        return {
          status: "degraded",
          message: err instanceof Error ? err.message : String(err),
        };
      }
    },
  });

  // Feature readiness probes — configuration only, no network I/O.
  // A missing key is "degraded", never "down": rollupStatus() turns any
  // "down" probe into a 503, which would take the liveness probe with it.
  for (const feature of ["paymentsUpload", "email", "streaming", "commentary"] as const) {
    registry.add({
      name: `feature:${feature}`,
      critical: false,
      run: async () => {
        const { ready, missing } = featureReadiness(feature);
        return ready
          ? { status: "healthy", message: "configured" }
          : { status: "degraded", message: `missing: ${missing.join(", ")}` };
      },
    });
  }

  try {
    const result = await registry.run();

    // Log health check at debug level (these happen frequently).
    log.debug("Health check", {
      status: result.status,
      services: Object.fromEntries(
        Object.entries(result.services).map(([k, v]) => [
          k,
          { status: v.status, latencyMs: v.latencyMs },
        ])
      ),
    });

    const body: HealthResponse = {
      ...result,
      revision: process.env.SENTRY_RELEASE || process.env.COMMIT_SHA || undefined,
    };
    return healthResponse(body);
  } catch (err) {
    // The registry itself shouldn't throw, but just in case…
    await captureError(err, {
      level: "fatal",
      context: { service: "web" },
      tags: { source: "health-endpoint" },
    });
    return NextResponse.json(
      { status: "down", checkedAt: new Date().toISOString(), services: {} },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
