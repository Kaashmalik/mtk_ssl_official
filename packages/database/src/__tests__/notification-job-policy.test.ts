import { describe, expect, it } from "vitest"
import {
  NOTIFICATION_JOB_MAX_ATTEMPTS,
  classifyNotificationJobFailure,
  describeNotificationJobState,
  isNotificationJobDeadLettered,
  notificationJobRetryDelayMs,
} from "../lib/notification-job-policy"

/**
 * ENH-06-04: the durable notification-job policy. The row is the record; these
 * rules decide retry timing and the terminal boundary, so a worker cannot
 * invent a different schedule and a failed job is never retried forever.
 */
describe("ENH-06-04: notification job policy", () => {
  it("backs off monotonically up to the cap", () => {
    const delays = [1, 2, 3, 4, 5, 6, 7, 8].map(notificationJobRetryDelayMs)
    for (let i = 1; i < delays.length; i++) {
      expect(delays[i]).toBeGreaterThanOrEqual(delays[i - 1])
    }
    expect(delays[0]).toBe(5_000)
    expect(delays.at(-1)).toBe(3_600_000)
    expect(() => notificationJobRetryDelayMs(0)).toThrow()
    expect(() => notificationJobRetryDelayMs(1.5)).toThrow()
  })

  it("dead-letters exactly at the attempt cap", () => {
    expect(isNotificationJobDeadLettered(NOTIFICATION_JOB_MAX_ATTEMPTS - 1)).toBe(false)
    expect(isNotificationJobDeadLettered(NOTIFICATION_JOB_MAX_ATTEMPTS)).toBe(true)
  })

  it("classifies permanent refusals as terminal and transport failures as retryable", () => {
    expect(classifyNotificationJobFailure({ attempts: 1, reason: "consent_off", permanent: true }))
      .toEqual({ outcome: "cancelled", reason: "consent_off" })
    expect(classifyNotificationJobFailure({ attempts: 1, reason: "network_unknown", permanent: false }))
      .toEqual({ outcome: "retry", reason: "network_unknown" })
  })

  it("dead-letters a non-permanent failure once the attempt cap is reached", () => {
    expect(classifyNotificationJobFailure({
      attempts: NOTIFICATION_JOB_MAX_ATTEMPTS,
      reason: "provider_http_500",
      permanent: false,
    })).toEqual({ outcome: "dead", reason: "provider_http_500" })
  })

  it("describes each state honestly", () => {
    const now = new Date("2026-10-21T00:00:00Z")
    expect(describeNotificationJobState({ state: "provider_accepted", attempts: 1, nextAttemptAt: now, lastError: null }))
      .toMatch(/not proof of device display/)
    expect(describeNotificationJobState({ state: "dead_lettered", attempts: 8, nextAttemptAt: now, lastError: "x" }))
      .toMatch(/dead-lettered after 8 attempts/)
    expect(describeNotificationJobState({ state: "pending", attempts: 2, nextAttemptAt: now, lastError: null }))
      .toMatch(/pending \(attempt 2\/8\)/)
  })
})
