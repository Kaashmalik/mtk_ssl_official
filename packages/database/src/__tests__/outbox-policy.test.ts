import { describe, expect, it } from "vitest"
import {
  OUTBOX_MAX_ATTEMPTS,
  backoffMs,
  describeOutboxState,
  idempotencyKey,
  isDeadLettered,
  isDeliverable,
  markDelivered,
  markFailed,
  parseIdempotencyKey,
} from "../lib/outbox-policy"

describe("outbox policy (Batch 150, SCORE-12)", () => {
  it("the idempotency key is the canonical topic:eventId pair", () => {
    expect(idempotencyKey("match.score", "evt-1")).toBe("match.score:evt-1")
    expect(parseIdempotencyKey("match.score:evt-1")).toEqual({ topic: "match.score", eventId: "evt-1" })
    expect(parseIdempotencyKey("no-colon")).toBeNull()
    expect(parseIdempotencyKey(":x")).toBeNull()
    expect(parseIdempotencyKey("x:")).toBeNull()
    expect(() => idempotencyKey("", "x")).toThrow()
  })

  it("backoff is bounded and monotonic up to the cap", () => {
    const seq = [0, 1, 2, 3, 4, 5, 6].map(backoffMs)
    for (let i = 1; i < seq.length; i++) expect(seq[i]).toBeGreaterThanOrEqual(seq[i - 1])
    expect(backoffMs(100)).toBe(3_600_000)
  })

  it("a row is dead-lettered only at the attempt cap, never silently retried forever", () => {
    expect(isDeadLettered(OUTBOX_MAX_ATTEMPTS - 1)).toBe(false)
    expect(isDeadLettered(OUTBOX_MAX_ATTEMPTS)).toBe(true)
    expect(isDeadLettered(OUTBOX_MAX_ATTEMPTS + 5)).toBe(true)
  })

  it("deliverability is decided by state, never by wall-clock hope", () => {
    const now = new Date("2026-01-01T00:00:00Z")
    const base = { id: 1, topic: "t", eventId: "e", attempts: 0, nextAttemptAt: new Date(now.getTime() - 1000), deliveredAt: null, lastError: null }
    expect(isDeliverable(base, now)).toBe(true)
    expect(isDeliverable({ ...base, deliveredAt: now }, now)).toBe(false)
    expect(isDeliverable({ ...base, nextAttemptAt: new Date(now.getTime() + 1000) }, now)).toBe(false)
    expect(isDeliverable({ ...base, attempts: OUTBOX_MAX_ATTEMPTS }, now)).toBe(false)
  })

  it("markDelivered clears the error and stamps the time; markFailed never erases history", () => {
    const now = new Date("2026-01-01T00:00:00Z")
    const row = { id: 1, topic: "t", eventId: "e", attempts: 2, nextAttemptAt: new Date(now.getTime() - 1), deliveredAt: null, lastError: "boom" }
    const delivered = markDelivered(row, now)
    expect(delivered.deliveredAt).toBe(now)
    expect(delivered.lastError).toBeNull()
    expect(delivered.attempts).toBe(2) // attempt history survives delivery
    const failed = markFailed(row, now, "still boom")
    expect(failed.attempts).toBe(3)
    expect(failed.lastError).toBe("still boom")
    expect(failed.nextAttemptAt.getTime()).toBeGreaterThan(now.getTime())
    expect(failed.deliveredAt).toBeNull()
  })

  it("a failed row past the cap becomes dead-lettered and stops scheduling", () => {
    const now = new Date("2026-01-01T00:00:00Z")
    const row = { id: 1, topic: "t", eventId: "e", attempts: OUTBOX_MAX_ATTEMPTS - 1, nextAttemptAt: new Date(now.getTime() - 1), deliveredAt: null, lastError: null }
    const failed = markFailed(row, now, "final")
    expect(failed.attempts).toBe(OUTBOX_MAX_ATTEMPTS)
    expect(isDeadLettered(failed.attempts)).toBe(true)
    expect(describeOutboxState(failed)).toMatch(/dead-lettered/)
  })

  it("describeOutboxState reports delivered, dead-lettered and pending honestly", () => {
    const now = new Date("2026-01-01T00:00:00Z")
    expect(describeOutboxState({ id: 1, topic: "t", eventId: "e", attempts: 0, nextAttemptAt: now, deliveredAt: now, lastError: null })).toMatch(/delivered at/)
    expect(describeOutboxState({ id: 1, topic: "t", eventId: "e", attempts: 8, nextAttemptAt: now, deliveredAt: null, lastError: "x" })).toMatch(/dead-lettered/)
    expect(describeOutboxState({ id: 1, topic: "t", eventId: "e", attempts: 1, nextAttemptAt: now, deliveredAt: null, lastError: null })).toMatch(/pending/)
  })
})
