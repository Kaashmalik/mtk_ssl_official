/**
 * ENH-08-02: durable provider-job retry policy.
 *
 * A lost response is uncertain, not a failure: it must reconcile the provider
 * before another create/start. Permanent provider refusals stop immediately.
 * Every retry is bounded and jittered; a crashed final attempt is dead-lettered
 * by the worker rather than leased forever.
 */

export const BROADCAST_JOB_MAX_ATTEMPTS = 8
export const BROADCAST_JOB_BASE_DELAY_MS = 5_000
export const BROADCAST_JOB_MAX_DELAY_MS = 60 * 60 * 1_000

const PERMANENT_CODES = new Set([
  "provider_refused",
  "credentials_expired",
  "credentials_revoked",
  "destination_not_found",
  "destination_not_owned",
  "invalid_request",
  "unsupported_provider",
])

const UNCERTAIN_CODES = new Set([
  "transport_uncertain",
  "provider_timeout",
  "provider_5xx",
  "rate_limited",
  "unreadable_response",
])

export type BroadcastJobRetryDecision =
  | { state: "succeeded" }
  | { state: "failed"; reason: string }
  | { state: "dead_lettered"; reason: string }
  | { state: "pending"; nextAttemptAt: Date; delayMs: number }

export function broadcastJobRetryDecision(input: {
  attempts: number
  maxAttempts?: number
  code: string
  now?: Date
  jitter?: number
}): BroadcastJobRetryDecision {
  const maxAttempts = input.maxAttempts ?? BROADCAST_JOB_MAX_ATTEMPTS
  const attempts = Number.isSafeInteger(input.attempts) && input.attempts >= 0
    ? input.attempts
    : 0
  const code = input.code.trim().toLowerCase()
  if (code === "succeeded") return { state: "succeeded" }

  const permanent = PERMANENT_CODES.has(code)
  const uncertain = UNCERTAIN_CODES.has(code)
  if (permanent) return { state: "failed", reason: code }
  if (attempts >= maxAttempts) return { state: "dead_lettered", reason: code || "attempts_exhausted" }
  // Unknown codes are transport-like but still bounded; never mark live.
  if (!uncertain && !code) return { state: "pending", ...delay(attempts, input.now, input.jitter) }
  return { state: "pending", ...delay(attempts, input.now, input.jitter) }
}

function delay(attempts: number, now = new Date(), jitter = 0): { delayMs: number; nextAttemptAt: Date } {
  const exponent = Math.min(Math.max(0, attempts), 10)
  const base = Math.min(BROADCAST_JOB_MAX_DELAY_MS, BROADCAST_JOB_BASE_DELAY_MS * 2 ** exponent)
  const boundedJitter = Number.isFinite(jitter) ? Math.max(0, Math.min(0.25, jitter)) : 0
  const factor = 1 + (boundedJitter === 0 ? 0 : (attempts % 2 === 0 ? boundedJitter : -boundedJitter))
  const delayMs = Math.max(1_000, Math.round(base * factor))
  return { delayMs, nextAttemptAt: new Date(now.getTime() + delayMs) }
}

/**
 * A lease settlement is only accepted from the worker that still owns the
 * lease. A stale replica cannot complete/rewind another worker's job.
 */
export function broadcastJobLeaseSettlement(input: {
  requestedBy: string
  leaseOwner: string | null
  leaseExpiresAt: Date | null
  now?: Date
}): { accepted: true } | { accepted: false; reason: "not_owned" | "expired" } {
  const now = input.now ?? new Date()
  if (!input.leaseOwner || input.leaseOwner !== input.requestedBy) {
    return { accepted: false, reason: "not_owned" }
  }
  if (input.leaseExpiresAt && input.leaseExpiresAt <= now) {
    return { accepted: false, reason: "expired" }
  }
  return { accepted: true }
}
