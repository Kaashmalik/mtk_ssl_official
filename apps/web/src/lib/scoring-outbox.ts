import { db, scoringOutbox } from "@mtk/database"
import { z } from "zod"
import { idempotencyKey, OUTBOX_MAX_ATTEMPTS } from "@mtk/database/lib/outbox-policy"

/**
 * SCORE-12 (Batch 150): the producer side. A scoring write enqueues an
 * outbox row in the SAME transaction as the write, so a crash between
 * "score saved" and "fan-out" never loses the event. The row carries the
 * canonical idempotency key; the consumer dedupes on it.
 */

export interface EnqueueInput {
  tenantId: string
  matchId: string
  topic: string
  eventId: string
  payload: unknown
}

export async function enqueueScoringEvent(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  input: EnqueueInput,
): Promise<{ enqueued: true; idempotencyKey: string }> {
  z.string().uuid().parse(input.tenantId)
  z.string().uuid().parse(input.matchId)
  if (!input.topic || !input.eventId) throw new Error("topic and eventId are required")
  const key = idempotencyKey(input.topic, input.eventId)
  await tx.insert(scoringOutbox).values({
    tenantId: input.tenantId,
    matchId: input.matchId,
    topic: input.topic,
    eventId: input.eventId,
    payload: input.payload as never,
  })
  return { enqueued: true, idempotencyKey: key }
}

/**
 * SCORE-12 consumer skeleton. Idempotent by deliveredAt: a row that is
 * already delivered is skipped (the consumer may see it again after a
 * crash-replay); a dead-lettered row is skipped (never retried forever);
 * a deliverable row is handed to the handler and, on success, marked
 * delivered; on failure, marked failed with backoff. Returns counts only -
 * the caller (a worker) drives the loop and the DB reads.
 */
export interface ConsumerHandler {
  (row: { id: number; topic: string; eventId: string; payload: unknown }): Promise<void>
}

export interface ConsumerResult {
  delivered: number
  retried: number
  deadLettered: number
  skipped: number
}

export async function processOutboxBatch(
  rows: Array<{
    id: number
    tenantId: string
    matchId: string
    topic: string
    eventId: string
    payload: unknown
    attempts: number
    nextAttemptAt: Date
    deliveredAt: Date | null
    lastError: string | null
  }>,
  handler: ConsumerHandler,
  now: Date,
  persist: {
    markDelivered: (id: number, now: Date) => Promise<void>
    markFailed: (id: number, now: Date, error: string) => Promise<void>
  },
): Promise<ConsumerResult> {
  const result: ConsumerResult = { delivered: 0, retried: 0, deadLettered: 0, skipped: 0 }
  for (const row of rows) {
    if (row.deliveredAt !== null) { result.skipped++; continue }
    if (row.attempts >= OUTBOX_MAX_ATTEMPTS) { result.deadLettered++; continue }
    if (row.nextAttemptAt.getTime() > now.getTime()) { result.skipped++; continue }
    try {
      await handler({ id: row.id, topic: row.topic, eventId: row.eventId, payload: row.payload })
      await persist.markDelivered(row.id, now)
      result.delivered++
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await persist.markFailed(row.id, now, message)
      if (row.attempts + 1 >= OUTBOX_MAX_ATTEMPTS) result.deadLettered++
      else result.retried++
    }
  }
  return result
}
