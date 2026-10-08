export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { verifySuperAdmin } from "@/lib/admin-auth";
import {
  db,
  users,
  tenants,
  tournaments,
  teams,
  matches,
  players,
  errorLogs,
} from "@mtk/database";
import { count, desc, eq } from "drizzle-orm";
import {
  HealthRegistry,
  pingPostgres,
  pingRedis,
  captureError,
  getRequestLogger,
} from "@mtk/observability";

/**
 * GET /api/system-health
 *
 * Super-admin-only endpoint (different from the anonymous /api/health).
 * Returns detailed platform health: per-dependency status, table row counts,
 * and (with ?type=errors) the most recent unresolved error logs.
 *
 * Query params:
 *   ?type=errors   Return recent unresolved error logs instead of health data.
 *   ?limit=N       Max errors to return (default 20, capped at 100).
 */
export async function GET(request: NextRequest) {
  const adminId = await verifySuperAdmin();
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const log = getRequestLogger();
  const type = request.nextUrl?.searchParams.get("type");

  // -----------------------------------------------------------------------
  // Branch: ?type=errors — return recent unresolved error logs.
  // The dashboard's "Error Logs" tab fetches this.
  // -----------------------------------------------------------------------
  if (type === "errors") {
    try {
      const limitRaw = Number(request.nextUrl?.searchParams.get("limit") ?? 20);
      const limit = Math.max(1, Math.min(100, Number.isFinite(limitRaw) ? limitRaw : 20));

      const errors = await db
        .select({
          id: errorLogs.id,
          service: errorLogs.service,
          severity: errorLogs.severity,
          errorType: errorLogs.errorType,
          message: errorLogs.message,
          stackTrace: errorLogs.stackTrace,
          userId: errorLogs.userId,
          tenantId: errorLogs.tenantId,
          metadata: errorLogs.metadata,
          isResolved: errorLogs.isResolved,
          createdAt: errorLogs.createdAt,
        })
        .from(errorLogs)
        .where(eq(errorLogs.isResolved, false))
        .orderBy(desc(errorLogs.createdAt))
        .limit(limit);

      return NextResponse.json({ errors });
    } catch (err) {
      log.error("Failed to fetch error logs", err);
      await captureError(err, {
        level: "error",
        context: { adminId, path: "/api/system-health?type=errors" },
        tags: { source: "system-health" },
      });
      return NextResponse.json(
        { error: "Failed to fetch error logs", errors: [] },
        { status: 500 }
      );
    }
  }

  // -----------------------------------------------------------------------
  // Default branch: full platform health.
  // -----------------------------------------------------------------------
  try {
    const registry = new HealthRegistry();

    // Postgres probe (critical).
    registry.add({
      name: "postgres",
      critical: true,
      run: () =>
        pingPostgres({
          ping: () => db.select({ id: users.id }).from(users).limit(1),
          degradedAboveMs: 500,
        }),
    });

    // Redis probe (non-critical — degrade is acceptable).
    // We create a throwaway client for the probe and disconnect it after.
    type RedisProbeClient = { ping(): Promise<unknown>; disconnect(): void };
    let redisClient: RedisProbeClient | null = null;
    const redisUrl = process.env.REDIS_URL;
    if (redisUrl) {
      try {
        const { default: Redis } = await import("ioredis");
        const client = new Redis(redisUrl, {
          maxRetriesPerRequest: 1,
          lazyConnect: true,
          connectTimeout: 1000,
        });
        await client.connect();
        redisClient = client as unknown as RedisProbeClient;
      } catch (err) {
        log.warn("Redis probe init failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    registry.add({
      name: "redis",
      run: () => pingRedis({ client: redisClient }),
    });

    const [healthResult, ...counts] = await Promise.all([
      registry.run(),
      db.select({ count: count() }).from(tenants),
      db.select({ count: count() }).from(tournaments),
      db.select({ count: count() }).from(teams),
      db.select({ count: count() }).from(matches),
      db.select({ count: count() }).from(players),
    ]);

    // Always disconnect the probe Redis client to avoid leaking connections.
    try {
      await redisClient?.disconnect();
    } catch {
      // best-effort
    }

    // Reconcile the postgres probe status with the DB-ping result.
    const dbStatus =
      (healthResult.services.postgres?.status as string) ?? "healthy";

    return NextResponse.json({
      status: healthResult.status,
      checkedAt: healthResult.checkedAt,
      services: {
        database: {
          status: dbStatus,
          latency: healthResult.services.postgres?.latencyMs
            ? `${healthResult.services.postgres.latencyMs}ms`
            : undefined,
          message: healthResult.services.postgres?.message ?? "Connected",
        },
        redis: healthResult.services.redis,
        // Auth (Clerk) and the API are external services; we don't have a
        // cheap, non-side-effect way to probe them here. They are marked
        // "unknown" rather than lying with a hardcoded "healthy".
        api: { status: "unknown", message: "Not probed from admin app" },
        auth: { status: "unknown", message: "See Clerk status page" },
      },
      stats: {
        tenants: counts[0][0]?.count ?? 0,
        tournaments: counts[1][0]?.count ?? 0,
        teams: counts[2][0]?.count ?? 0,
        matches: counts[3][0]?.count ?? 0,
        players: counts[4][0]?.count ?? 0,
      },
    });
  } catch (error) {
    log.error("System health API error", error);
    await captureError(error, {
      level: "fatal",
      context: { adminId, path: "/api/system-health" },
      tags: { source: "system-health" },
    });
    return NextResponse.json(
      {
        status: "down",
        services: {
          database: {
            status: "down",
            message: error instanceof Error ? error.message : String(error),
          },
        },
      },
      { status: 500 }
    );
  }
}
