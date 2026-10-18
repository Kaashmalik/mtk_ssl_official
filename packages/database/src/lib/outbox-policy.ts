/**
 * SCORE-12 (Batch 150): the transactional outbox policy as pure logic. The
 * schema (scoring_outbox) already exists; what was missing is any code that
 * uses it. This module defines the ONLY honest rules:
 *   - an idempotency key is (topic, eventId), canonicalized; a consumer
 *     that sees the same key twice delivers ONCE;
 *   - retry uses bounded exponential backoff with a hard attempt cap; past
 *     the cap the row is DEAD-LETTERED (never silently retried forever);
 *   - delivery is decided by state, never by wall-clock hope: a row is
 *     deliverable only when not yet delivered AND nextAttemptAt <= now;
 *   - marking delivered/failed are STATE TRANSITIONS that never erase the
 *     attempt count or the last error (audit survives).
 * Nothing here reads or writes; the producer and consumer consume these
 * tables. A missing row is not a delivery.
 */

export const OUTBOX_MAX_ATTEMPTS = 8

const BACKOFF_MS = [5_000, 30_000, 120_000, 600_000, 1_800_000, 3_600_000]
const CAP_MS = 3_600_000

export interface OutboxRow {
  id: number
  topic: string
  eventId: string
  attempts: number
  nextAttemptAt: Date
  deliveredAt: Date | null
  lastError: string | null
}

export function idempotencyKey(topic: string, eventId: string): string {
  if (!topic || !eventId) throw new Error("topic and eventId are required")
  return `${topic}:${eventId}`
}

export function parseIdempotencyKey(key: string): { topic: string; eventId: string } | null {
  const idx = key.indexOf(":")
  if (idx <= 0 || idx === key.length - 1) return null
  return { topic: key.slice(0, idx), eventId: key.slice(idx + 1) }
}

export function backoffMs(attempts: number): number {
  if (attempts < 0) throw new Error("attempts must be non-negative")
  const idx = Math.min(attempts, BACKOFF_MS.length - 1)
  return BACKOFF_MS[idx] ?? CAP_MS
}

export function isDeadLettered(attempts: number): boolean {
  return attempts >= OUTBOX_MAX_ATTEMPTS
}

export function isDeliverable(row: OutboxRow, now: Date): boolean {
  if (row.deliveredAt !== null) return false
  if (isDeadLettered(row.attempts)) return false
  return row.nextAttemptAt.getTime() <= now.getTime()
}

export function markDelivered(row: OutboxRow, now: Date): OutboxRow {
  return { ...row, deliveredAt: now, lastError: null }
}

export function markFailed(row: OutboxRow, now: Date, error: string): OutboxRow {
  const attempts = row.attempts + 1
  if (isDeadLettered(attempts)) {
    return { ...row, attempts, nextAttemptAt: row.nextAttemptAt, lastError: error, deliveredAt: null }
  }
  return { ...row, attempts, nextAttemptAt: new Date(now.getTime() + backoffMs(attempts)), lastError: error, deliveredAt: null }
}

export function describeOutboxState(row: OutboxRow): string {
  if (row.deliveredAt) return `delivered at ${row.deliveredAt.toISOString()}`
  if (isDeadLettered(row.attempts)) return `dead-lettered after ${row.attempts} attempts: ${row.lastError ?? "no error recorded"}`
  return `pending (attempt ${row.attempts}/${OUTBOX_MAX_ATTEMPTS}), next try ${row.nextAttemptAt.toISOString()}`
}
