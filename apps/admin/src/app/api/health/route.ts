import { NextResponse } from "next/server";
import { HealthRegistry, pingPostgres, healthResponse, captureError, getRequestLogger, type HealthResponse } from "@mtk/observability";
import { db, users } from "@mtk/database";

export const dynamic = "force-dynamic";

/**
 * Anonymous health endpoint for the admin app.
 *
 * No auth required — this is the only unauthenticated route in the admin app.
 * Used by Kubernetes liveness/readiness probes, Vercel monitoring, and
 * external uptime bots.
 */
export async function GET() {
  const log = getRequestLogger();

  const registry = new HealthRegistry();

  registry.add({
    name: "postgres",
    critical: true,
    run: () =>
      pingPostgres({
        ping: () => db.select({ id: users.id }).from(users).limit(1),
        degradedAboveMs: 500,
      }),
  });

  try {
    const result = await registry.run();

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
    await captureError(err, {
      level: "fatal",
      context: { service: "admin" },
      tags: { source: "health-endpoint" },
    });
    return NextResponse.json(
      { status: "down", checkedAt: new Date().toISOString(), services: {} },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
