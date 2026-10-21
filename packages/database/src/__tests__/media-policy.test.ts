import { describe, expect, it } from "vitest"
import {
  MEDIA_CLEANUP_MAX_ATTEMPTS,
  mediaCleanupIsTerminal,
  mediaCleanupRetryDelayMs,
  mediaQuotaDecision,
  mediaUploadSessionExpired,
  mediaWebhookDedupKey,
  mediaWebhookTimestampAcceptable,
} from "../lib/media-policy"

/**
 * ENH-07-01: database/worker-side media rules.
 *
 * No approved provider quota exists yet, so the honest default is refusal. The
 * cleanup ladder is bounded like the other durable queues; webhook freshness
 * and dedup identity are explicit, never inferred from a timestamp.
 */
describe("ENH-07-01: media quota reservations", () => {
  it("refuses when no approved limit is configured - never unlimited", () => {
    expect(mediaQuotaDecision({ limitBytes: null, usedBytes: 0, reservedBytes: 0, requestedBytes: 1 }))
      .toEqual({ allowed: false, reason: "quota_unconfigured", availableBytes: 0 })
    expect(mediaQuotaDecision({ limitBytes: 0, usedBytes: 0, reservedBytes: 0, requestedBytes: 1 }))
      .toEqual({ allowed: false, reason: "quota_unconfigured", availableBytes: 0 })
  })

  it("reserves only within the remaining ceiling, counting in-flight sessions", () => {
    expect(mediaQuotaDecision({ limitBytes: 1_000, usedBytes: 200, reservedBytes: 300, requestedBytes: 500 }))
      .toEqual({ allowed: true, reservedAfter: 800 })
    expect(mediaQuotaDecision({ limitBytes: 1_000, usedBytes: 200, reservedBytes: 300, requestedBytes: 501 }))
      .toEqual({ allowed: false, reason: "quota_exceeded", availableBytes: 500 })
    // A zero-byte request is not a reservation.
    expect(mediaQuotaDecision({ limitBytes: 1_000, usedBytes: 0, reservedBytes: 0, requestedBytes: 0 }))
      .toEqual({ allowed: false, reason: "quota_exceeded", availableBytes: 1_000 })
  })

  it("refuses negative or non-integer arithmetic instead of coercing it", () => {
    expect(mediaQuotaDecision({ limitBytes: 1_000, usedBytes: -1, reservedBytes: 0, requestedBytes: 10 }))
      .toEqual({ allowed: false, reason: "invalid_request", availableBytes: 0 })
    expect(mediaQuotaDecision({ limitBytes: 1_000, usedBytes: 0.5, reservedBytes: 0, requestedBytes: 10 }))
      .toEqual({ allowed: false, reason: "invalid_request", availableBytes: 0 })
    expect(mediaQuotaDecision({ limitBytes: 1_000, usedBytes: 2_000, reservedBytes: 0, requestedBytes: 10 }))
      .toEqual({ allowed: false, reason: "quota_exceeded", availableBytes: 0 })
  })
})

describe("ENH-07-01: upload-session and cleanup lifecycle", () => {
  it("expires a session at the boundary, not after it", () => {
    const at = new Date("2026-10-21T12:00:00Z")
    expect(mediaUploadSessionExpired({ expiresAt: at, now: at })).toBe(true)
    expect(mediaUploadSessionExpired({ expiresAt: new Date(at.getTime() + 1), now: at })).toBe(false)
  })

  it("backs off monotonically up to the cap and dead-letters", () => {
    const delays = [1, 2, 3, 4, 5, 6, 7, 8].map(mediaCleanupRetryDelayMs)
    for (let i = 1; i < delays.length; i++) {
      expect(delays[i]).toBeGreaterThanOrEqual(delays[i - 1])
    }
    expect(delays[0]).toBe(5_000)
    expect(delays.at(-1)).toBe(3_600_000)
    expect(() => mediaCleanupRetryDelayMs(0)).toThrow()
    expect(MEDIA_CLEANUP_MAX_ATTEMPTS).toBe(8)
    expect(mediaCleanupIsTerminal({
      state: "pending", attempts: MEDIA_CLEANUP_MAX_ATTEMPTS, maxAttempts: MEDIA_CLEANUP_MAX_ATTEMPTS,
    })).toBe(true)
    expect(mediaCleanupIsTerminal({
      state: "leased", attempts: MEDIA_CLEANUP_MAX_ATTEMPTS, maxAttempts: MEDIA_CLEANUP_MAX_ATTEMPTS,
    })).toBe(false)
  })
})

describe("ENH-07-01: webhook freshness and dedup", () => {
  it("accepts only a small signed window and tolerates limited future skew", () => {
    const now = 1_000_000
    expect(mediaWebhookTimestampAcceptable({ timestampSeconds: now - 300, nowSeconds: now })).toBe(true)
    expect(mediaWebhookTimestampAcceptable({ timestampSeconds: now - 301, nowSeconds: now })).toBe(false)
    expect(mediaWebhookTimestampAcceptable({ timestampSeconds: now + 60, nowSeconds: now })).toBe(true)
    expect(mediaWebhookTimestampAcceptable({ timestampSeconds: now + 61, nowSeconds: now })).toBe(false)
    expect(mediaWebhookTimestampAcceptable({ timestampSeconds: NaN, nowSeconds: now })).toBe(false)
  })

  it("keys dedup on provider + event id, never a timestamp", () => {
    expect(mediaWebhookDedupKey({ provider: "Cloudinary", eventId: " evt_1 " }))
      .toBe("media-webhook:cloudinary:evt_1")
    expect(() => mediaWebhookDedupKey({ provider: "", eventId: "evt_1" })).toThrow()
    expect(() => mediaWebhookDedupKey({ provider: "cloudinary", eventId: " " })).toThrow()
  })
})
