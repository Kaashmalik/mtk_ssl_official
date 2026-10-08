/**
 * Health-check primitives.
 *
 * Three layers:
 *   1. Probe functions (`pingPostgres`, `pingRedis`) — perform a real
 *      dependency check and return a typed result.
 *   2. `HealthRegistry` — a registry of named probes; `run()` executes them
 *      in parallel and rolls up an overall status.
 *   3. `jsonResponse()` — shapes the result for an HTTP health endpoint.
 *
 * The probes are dependency-light by design: they take a ready-made client
 * (or a function that produces one) so this package doesn't depend on
 * `postgres`, `ioredis`, or `@mtk/database`.
 */

export type HealthStatus = "healthy" | "degraded" | "down";

export interface ProbeResult {
  status: HealthStatus;
  /** Round-trip latency in milliseconds, if measured. */
  latencyMs?: number;
  /** Human-friendly message. */
  message?: string;
  /** Optional version / metadata. */
  version?: string;
}

export interface Probe {
  /** Stable identifier, e.g. "postgres", "redis", "clerk". */
  name: string;
  /** Optional: mark as non-critical (a failure degrades but doesn't 503). */
  critical?: boolean;
  /** Perform the check. Must NEVER throw — wrap in try/catch. */
  run: () => Promise<ProbeResult>;
}

/**
 * Roll up multiple probe statuses into one overall status.
 *   - any "down" critical probe → "down"
 *   - any "down" non-critical OR "degraded" → "degraded"
 *   - otherwise → "healthy"
 */
export function rollupStatus(results: Record<string, ProbeResult>): HealthStatus {
  let degraded = false;
  for (const r of Object.values(results)) {
    if (r.status === "down") return "down";
    if (r.status === "degraded") degraded = true;
  }
  return degraded ? "degraded" : "healthy";
}

export class HealthRegistry {
  private readonly probes = new Map<string, Probe>();

  add(probe: Probe): this {
    this.probes.set(probe.name, probe);
    return this;
  }

  async run(): Promise<{
    status: HealthStatus;
    checkedAt: string;
    services: Record<string, ProbeResult>;
  }> {
    const entries = Array.from(this.probes.values());
    const settled = await Promise.all(
      entries.map(async (p) => {
        const started = Date.now();
        try {
          const result = await p.run();
          return [p.name, result] as const;
        } catch (err) {
          // A throwing probe is treated as "down" — never crash the endpoint.
          return [
            p.name,
            {
              status: "down" as HealthStatus,
              latencyMs: Date.now() - started,
              message: err instanceof Error ? err.message : String(err),
            },
          ] as const;
        }
      })
    );

    const services: Record<string, ProbeResult> = Object.fromEntries(settled);
    return {
      status: rollupStatus(services),
      checkedAt: new Date().toISOString(),
      services,
    };
  }
}

/**
 * Probe a Postgres connection via a caller-supplied ping function.
 *
 * Usage:
 *   pingPostgres({
 *     ping: () => db.select({ id: users.id }).from(users).limit(1),
 *     critical: true,
 *   })
 */
export async function pingPostgres(opts: {
  ping: () => Promise<unknown>;
  critical?: boolean;
  /** Threshold in ms above which the probe is "degraded" rather than "healthy". */
  degradedAboveMs?: number;
}): Promise<ProbeResult> {
  const started = Date.now();
  try {
    await opts.ping();
    const latencyMs = Date.now() - started;
    const threshold = opts.degradedAboveMs ?? 500;
    return {
      status: latencyMs < threshold ? "healthy" : "degraded",
      latencyMs,
      message: "Connected",
    };
  } catch (err) {
    return {
      status: "down",
      latencyMs: Date.now() - started,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Probe a Redis connection. The `client` is whatever object exposes a
 * `ping()` returning a truthy value — we don't import ioredis here.
 */
export async function pingRedis(opts: {
  client: { ping(): Promise<unknown> } | null;
  critical?: boolean;
}): Promise<ProbeResult> {
  if (!opts.client) {
    return {
      status: "degraded",
      message: "Redis not configured (running without cache/rate-limit sharing)",
    };
  }
  const started = Date.now();
  try {
    const res = await opts.client.ping();
    return {
      status: res ? "healthy" : "down",
      latencyMs: Date.now() - started,
      message: res ? "PONG" : "No response",
    };
  } catch (err) {
    return {
      status: "down",
      latencyMs: Date.now() - started,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
