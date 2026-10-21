import { describe, expect, it } from "vitest"
import {
  BROADCAST_JOB_BASE_DELAY_MS, BROADCAST_JOB_MAX_ATTEMPTS, BROADCAST_JOB_MAX_DELAY_MS,
  broadcastJobLeaseSettlement, broadcastJobRetryDecision,
} from "../lib/broadcast-job-policy"

/** ENH-08-02: bounded retries, uncertain reconciliation, fenced settlement. */

describe("ENH-08-02: broadcast job retry policy", () => {
  it("stops on a permanent provider refusal without pretending success", () => {
    expect(broadcastJobRetryDecision({ attempts: 0, code: "credentials_revoked" }))
      .toEqual({ state: "failed", reason: "credentials_revoked" })
    expect(broadcastJobRetryDecision({ attempts: 3, code: "provider_refused" }))
      .toEqual({ state: "failed", reason: "provider_refused" })
  })

  it("retries transport uncertainty with a growing bounded delay", () => {
    const now = new Date("2026-10-21T10:00:00Z")
    const first = broadcastJobRetryDecision({ attempts: 0, code: "transport_uncertain", now })
    expect(first.state).toBe("pending")
    if (first.state === "pending") {
      expect(first.delayMs).toBe(BROADCAST_JOB_BASE_DELAY_MS)
      expect(first.nextAttemptAt.toISOString()).toBe("2026-10-21T10:00:05.000Z")
    }
    const later = broadcastJobRetryDecision({ attempts: 4, code: "provider_5xx", now })
    if (later.state === "pending") {
      expect(later.delayMs).toBeLessThanOrEqual(BROADCAST_JOB_MAX_DELAY_MS)
      expect(later.delayMs).toBeGreaterThan(BROADCAST_JOB_BASE_DELAY_MS)
    }
  })

  it("dead-letters the final attempt instead of leasing forever", () => {
    expect(broadcastJobRetryDecision({
      attempts: BROADCAST_JOB_MAX_ATTEMPTS, code: "provider_timeout",
    })).toEqual({ state: "dead_lettered", reason: "provider_timeout" })
  })

  it("never claims success for an unknown code", () => {
    const decision = broadcastJobRetryDecision({ attempts: 1, code: "provider_said_something" })
    expect(decision.state).toBe("pending")
  })

  it("accepts a settlement only from the live lease owner", () => {
    const now = new Date("2026-10-21T10:00:00Z")
    expect(broadcastJobLeaseSettlement({
      requestedBy: "worker-a", leaseOwner: "worker-a",
      leaseExpiresAt: new Date(now.getTime() + 10_000), now,
    })).toEqual({ accepted: true })
    expect(broadcastJobLeaseSettlement({
      requestedBy: "worker-b", leaseOwner: "worker-a",
      leaseExpiresAt: new Date(now.getTime() + 10_000), now,
    })).toEqual({ accepted: false, reason: "not_owned" })
    expect(broadcastJobLeaseSettlement({
      requestedBy: "worker-a", leaseOwner: "worker-a",
      leaseExpiresAt: new Date(now.getTime() - 1), now,
    })).toEqual({ accepted: false, reason: "expired" })
  })
})
