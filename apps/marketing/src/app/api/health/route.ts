import { NextResponse } from "next/server";
import { healthResponse, captureError, type HealthResponse } from "@mtk/observability";

export const dynamic = "force-dynamic";

/**
 * Anonymous health endpoint for the marketing site.
 *
 * Marketing is a static/content app with no database dependency in its
 * critical path, so this is a simple liveness check. Returns 200 as long
 * as the server process is up.
 *
 * If a DATABASE_URL is available, we'll optionally probe it and include
 * its status, but a DB failure will only degrade — not 503.
 */
export async function GET() {
  try {
    const services: Record<string, { status: string; latencyMs?: number; message?: string }> = {};

    // Optional DB probe — marketing doesn't critically depend on DB but
    // it's useful for ops to know if the shared DB is reachable.
    if (process.env.DATABASE_URL) {
      try {
        const { db, users } = await import("@mtk/database");
        const started = Date.now();
        await db.select({ id: users.id }).from(users).limit(1);
        const latencyMs = Date.now() - started;
        services.postgres = {
          status: latencyMs < 500 ? "healthy" : "degraded",
          latencyMs,
          message: "Connected",
        };
      } catch (err) {
        services.postgres = {
          status: "degraded",
          message: err instanceof Error ? err.message : String(err),
        };
      }
    }

    const status = Object.values(services).some((s) => s.status === "down")
      ? "down"
      : Object.values(services).some((s) => s.status === "degraded")
        ? "degraded"
        : "healthy";

    const body: HealthResponse = {
      status,
      checkedAt: new Date().toISOString(),
      services,
      revision: process.env.SENTRY_RELEASE || process.env.COMMIT_SHA || undefined,
    };

    return healthResponse(body);
  } catch (err) {
    await captureError(err, {
      level: "fatal",
      context: { service: "marketing" },
      tags: { source: "health-endpoint" },
    });
    return NextResponse.json(
      { status: "down", checkedAt: new Date().toISOString(), services: {} },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
