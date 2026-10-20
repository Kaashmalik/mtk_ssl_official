import { describe, expect, it, vi } from "vitest"
import { rateLimit } from "@/lib/rate-limit"

/**
 * ENH-01-04 (exhausted-bucket refusal): the in-memory fallback (dev, test,
 * single-instance, Edge-without-Upstash) computed success as
 * `remaining >= 0` - and an exhausted bucket reports remaining 0, so the
 * fallback NEVER refused a request and middleware's 429 path was dead code
 * outside Redis deployments. The contract: an empty bucket refuses.
 *
 * The Redis/Upstash paths already refuse via count/limit; this pins the
 * fallback onto the same contract.
 */

const UNIQUE = (id: string) => `rate-test-${id}-${Math.random().toString(36).slice(2).slice(-4)}`

describe("rate limit exhausted-bucket refusal (ENH-01-04)", () => {
  it("refuses once the bucket is empty, then admits again after refill", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-20T10:00:00Z") })
    const key = UNIQUE("empty")
    // limit 2 per 60s: refill interval 30s per token.
    const first = await rateLimit(key, 2, 60_000)
    const second = await rateLimit(key, 2, 60_000)
    expect(first.success).toBe(true)
    expect(second.success).toBe(true)

    const third = await rateLimit(key, 2, 60_000)
    expect(third.success).toBe(false)
    expect(third.remaining).toBe(0)
    // The reset points to a future instant where a token reappears.
    expect(third.reset).toBeGreaterThan(Date.now() / 1000 - 1)

    // A refused request consumes nothing: a parallel caller in the same
    // window still sees an empty bucket (no negative dip), and time getting
    // the next refill admits one token only.
    vi.setSystemTime(new Date("2026-10-20T10:00:30Z"))
    const fourth = await rateLimit(key, 2, 60_000)
    expect(fourth.success).toBe(true)
    expect(fourth.remaining).toBe(0)
    const fifth = await rateLimit(key, 2, 60_000)
    expect(fifth.success).toBe(false)
    vi.useRealTimers()
  })

  it("a distinct key has its own bucket", async () => {
    const keyA = UNIQUE("a")
    const keyB = UNIQUE("b")
    await rateLimit(keyA, 1, 60_000)
    const refused = await rateLimit(keyA, 1, 60_000)
    const otherKey = await rateLimit(keyB, 1, 60_000)
    expect(refused.success).toBe(false)
    expect(otherKey.success).toBe(true)
  })
})
