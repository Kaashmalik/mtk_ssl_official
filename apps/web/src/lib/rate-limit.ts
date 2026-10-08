import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

/**
 * Rate limiter with Upstash Redis-backed distributed counting (Edge-compatible)
 * or ioredis-backed sliding-window counting (Node-only).
 *
 * In production / Edge environments, uses Upstash Redis if UPSTASH_REDIS_REST_URL and
 * UPSTASH_REDIS_REST_TOKEN are set.
 *
 * In Node environments, uses ioredis if REDIS_URL is set.
 *
 * In development / fallback, uses an in-memory token-bucket.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RateLimitResult {
  success: boolean;
  remaining: number;
  reset: number;
  limit: number;
}

// ---------------------------------------------------------------------------
// In-memory fallback (dev, test, single-instance)
// ---------------------------------------------------------------------------

class InMemoryBucket {
  private tokens: number;
  private lastRefilled: number;
  private readonly limit: number;
  private readonly refillInterval: number;

  constructor(limit: number, windowMs: number) {
    this.limit = limit;
    this.tokens = limit;
    this.lastRefilled = Date.now();
    this.refillInterval = windowMs / limit;
  }

  consume(): { remaining: number; reset: number } {
    const now = Date.now();
    const elapsed = now - this.lastRefilled;
    const refilled = Math.floor(elapsed / this.refillInterval);

    if (refilled > 0) {
      this.tokens = Math.min(this.limit, this.tokens + refilled);
      this.lastRefilled = now - (elapsed % this.refillInterval);
    }

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return {
        remaining: this.tokens,
        reset: Math.ceil(
          this.lastRefilled + this.refillInterval * (this.limit - this.tokens)
        ),
      };
    }

    return { remaining: 0, reset: Math.ceil(this.lastRefilled + this.refillInterval) };
  }
}

const memoryBuckets = new Map<string, InMemoryBucket>();

function rateLimitMemory(
  key: string,
  limit: number,
  windowMs: number
): RateLimitResult {
  const bucketKey = `${key}:${limit}:${windowMs}`;
  let bucket = memoryBuckets.get(bucketKey);
  if (!bucket) {
    bucket = new InMemoryBucket(limit, windowMs);
    memoryBuckets.set(bucketKey, bucket);
  }

  const { remaining, reset } = bucket.consume();
  return {
    success: remaining >= 0,
    remaining,
    reset,
    limit,
  };
}

// ---------------------------------------------------------------------------
// Upstash Redis-backed rate limiter (Edge & Node compatible)
// ---------------------------------------------------------------------------

const upstashLimiters = new Map<string, Ratelimit>();

function getUpstashLimiter(limit: number, windowMs: number): Ratelimit | null {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;

  const key = `${limit}:${windowMs}`;
  let limiter = upstashLimiters.get(key);
  if (!limiter) {
    limiter = new Ratelimit({
      redis: new Redis({ url, token }),
      limiter: Ratelimit.slidingWindow(limit, `${windowMs} ms`),
      analytics: true,
      prefix: "ratelimit",
    });
    upstashLimiters.set(key, limiter);
  }
  return limiter;
}

async function rateLimitUpstash(
  key: string,
  limit: number,
  windowMs: number
): Promise<RateLimitResult | null> {
  const limiter = getUpstashLimiter(limit, windowMs);
  if (!limiter) return null;

  try {
    const { success, remaining, reset } = await limiter.limit(key);
    return {
      success,
      remaining,
      reset: Math.ceil(reset / 1000), // Convert to UNIX timestamp in seconds
      limit,
    };
  } catch (err) {
    console.warn("[rate-limit] Upstash rate limit failed, falling back:", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Redis-backed rate limiter (Node-only)
// ---------------------------------------------------------------------------

type RedisClient = {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number, mode?: string): Promise<number | null>;
  pipeline(): {
    incr(key: string): ReturnType<typeof import("ioredis").default.prototype.pipeline>;
    expire(key: string, seconds: number, mode?: string): ReturnType<typeof import("ioredis").default.prototype.pipeline>;
    exec(): Promise<Array<[Error | null, unknown] | null>>;
  };
  on(event: string, cb: (err: Error) => void): void;
  connect(): Promise<void>;
};

let redisClient: RedisClient | null | undefined;

async function getRedis(): Promise<RedisClient | null> {
  if (redisClient !== undefined) return redisClient;

  const url = process.env.REDIS_URL;
  if (!url) {
    redisClient = null;
    return null;
  }

  try {
    const { default: RedisClient } = await import("ioredis");
    const client = new RedisClient(url, {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      connectTimeout: 1000,
    }) as unknown as RedisClient;

    client.on("error", (err: Error) => {
      console.warn("[rate-limit] Redis error, falling back to in-memory:", err.message);
      redisClient = null;
    });

    await client.connect();
    redisClient = client;
    return client;
  } catch {
    console.warn("[rate-limit] Failed to connect to Redis, falling back to in-memory");
    redisClient = null;
    return null;
  }
}

async function rateLimitRedis(
  key: string,
  limit: number,
  windowSec: number
): Promise<RateLimitResult> {
  const client = await getRedis();
  if (!client) {
    return rateLimitMemory(key, limit, windowSec * 1000);
  }

  const windowKey = `ratelimit:${key}:${Math.floor(Date.now() / (windowSec * 1000))}`;

  try {
    const pipeline = client.pipeline();
    pipeline.incr(windowKey);
    pipeline.expire(windowKey, windowSec, "NX");
    const results = await pipeline.exec();

    const count = (results?.[0]?.[1] as number) ?? 0;
    const remaining = Math.max(0, limit - count);
    const reset = Math.ceil((Date.now() + windowSec * 1000) / 1000);

    return {
      success: count <= limit,
      remaining,
      reset,
      limit,
    };
  } catch {
    return rateLimitMemory(key, limit, windowSec * 1000);
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check or consume a rate-limit token.
 *
 * @param key      Unique identifier (user id, IP, or combination)
 * @param limit    Max requests allowed in the window
 * @param windowMs Window duration in milliseconds
 *
 * Usage:
 *   const { success, remaining } = await rateLimit(`user:${userId}`, 60, 60000);
 *   if (!success) return new Response("Too many requests", { status: 429 });
 */
export async function rateLimit(
  key: string,
  limit = 60,
  windowMs = 60000
): Promise<RateLimitResult> {
  // 1. Try Upstash Redis first (Edge-compatible, distributed, works in Next.js Middleware)
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    const upstashResult = await rateLimitUpstash(key, limit, windowMs);
    if (upstashResult !== null) return upstashResult;
  }

  // 2. Try Standard Redis (Node-only)
  if (process.env.REDIS_URL) {
    const windowSec = Math.ceil(windowMs / 1000);
    return rateLimitRedis(key, limit, windowSec);
  }

  // 3. Fallback to Local In-Memory
  return rateLimitMemory(key, limit, windowMs);
}

