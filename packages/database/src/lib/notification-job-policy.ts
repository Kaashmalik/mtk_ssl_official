/**
 * ENH-06-04: the durable notification-job policy as pure logic.
 *
 * The database row is the record; these rules decide when an attempt is owed,
 * how long to wait after a failure, and when a job is dead-lettered. Nothing
 * here reads or writes, so the same rules are testable without a database and
 * the worker cannot invent a different schedule than the one pinned here.
 */

export const NOTIFICATION_JOB_MAX_ATTEMPTS = 8

/** Retry ladder in seconds; the last step repeats up to the attempt cap. */
const RETRY_DELAYS_SECONDS = [5, 30, 120, 600, 1_800, 3_600] as const

export function notificationJobRetryDelayMs(attempt: number): number {
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new Error("attempt must be a positive integer")
  }
  const index = Math.min(attempt - 1, RETRY_DELAYS_SECONDS.length - 1)
  return RETRY_DELAYS_SECONDS[index] * 1_000
}

export function isNotificationJobDeadLettered(attempts: number): boolean {
  return attempts >= NOTIFICATION_JOB_MAX_ATTEMPTS
}

export type NotificationJobState =
  | "pending"
  | "leased"
  | "provider_accepted"
  | "cancelled"
  | "dead_lettered"

export function describeNotificationJobState(row: {
  state: NotificationJobState
  attempts: number
  nextAttemptAt: Date
  lastError: string | null
}): string {
  switch (row.state) {
    case "provider_accepted":
      return "provider accepted (not proof of device display)"
    case "cancelled":
      return `cancelled: ${row.lastError ?? "no reason recorded"}`
    case "dead_lettered":
      return `dead-lettered after ${row.attempts} attempts: ${row.lastError ?? "no error recorded"}`
    case "leased":
      return `leased (attempt ${row.attempts}/${NOTIFICATION_JOB_MAX_ATTEMPTS})`
    default:
      return `pending (attempt ${row.attempts}/${NOTIFICATION_JOB_MAX_ATTEMPTS}), next try ${row.nextAttemptAt.toISOString()}`
  }
}

/**
 * A delivery result is terminal only when the platform can name a reason not
 * to try again (consent, absent recipient, unwired channel, deduplicated).
 * Transport uncertainty and provider 5xx stay retryable; a caller that cannot
 * classify a failure must treat it as unknown, never as delivered.
 */
export type NotificationJobDelivery =
  | { outcome: "accepted" }
  | { outcome: "cancelled"; reason: string }
  | { outcome: "retry"; reason: string }
  | { outcome: "dead"; reason: string }

export function classifyNotificationJobFailure(input: {
  attempts: number
  reason: string
  permanent: boolean
}): NotificationJobDelivery {
  if (input.permanent) return { outcome: "cancelled", reason: input.reason }
  if (isNotificationJobDeadLettered(input.attempts)) {
    return { outcome: "dead", reason: input.reason }
  }
  return { outcome: "retry", reason: input.reason }
}
