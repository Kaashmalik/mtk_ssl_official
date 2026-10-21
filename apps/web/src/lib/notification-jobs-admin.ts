import { randomUUID } from "node:crypto"
import { auditLogs, db, notificationJobs } from "@mtk/database"
import { and, desc, eq, type SQL } from "drizzle-orm"
import { z } from "zod"

/**
 * ENH-06-04: dead-letter inspection, retry and resolution.
 *
 * A dead-lettered job is a record that the platform owed a notice and could not
 * deliver it after the bounded ladder. Operators can inspect the head of that
 * queue, deliberately requeue one (attempts reset, so the worker may claim it
 * again) or resolve it without sending (terminal `cancelled`). Both actions are
 * audited; neither can touch a job outside the requested tenant scope, and an
 * account-level job (`tenant_id IS NULL`) is only reachable without a tenant
 * filter - a league operator can never inspect another account's mail.
 */

export const NOTIFICATION_DEAD_LETTER_LIMIT = 100
export const NOTIFICATION_DEAD_LETTER_MAX_LIMIT = 200

const listInputSchema = z.object({
  /** Omit for the platform head (super-admin only); never defaults to "all". */
  tenantId: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(NOTIFICATION_DEAD_LETTER_MAX_LIMIT).default(NOTIFICATION_DEAD_LETTER_LIMIT),
}).strict()

export type NotificationDeadLetterListInput = z.input<typeof listInputSchema>

export type NotificationDeadLetter = {
  id: string
  tenantId: string | null
  recipientUserId: string
  eventId: string
  channel: string
  type: string
  title: string
  attempts: number
  lastError: string | null
  createdAt: Date
  resolvedAt: Date | null
}

function tenantScope(tenantId: string | undefined): SQL | undefined {
  return tenantId ? eq(notificationJobs.tenantId, tenantId) : undefined
}

/** Head of the dead-letter queue, newest first, bounded. */
export async function listNotificationJobDeadLetters(
  input: NotificationDeadLetterListInput = {},
): Promise<NotificationDeadLetter[]> {
  const parsed = listInputSchema.parse(input)
  return db
    .select({
      id: notificationJobs.id,
      tenantId: notificationJobs.tenantId,
      recipientUserId: notificationJobs.recipientUserId,
      eventId: notificationJobs.eventId,
      channel: notificationJobs.channel,
      type: notificationJobs.type,
      title: notificationJobs.title,
      attempts: notificationJobs.attempts,
      lastError: notificationJobs.lastError,
      createdAt: notificationJobs.createdAt,
      resolvedAt: notificationJobs.resolvedAt,
    })
    .from(notificationJobs)
    .where(and(eq(notificationJobs.state, "dead_lettered"), tenantScope(parsed.tenantId)))
    .orderBy(desc(notificationJobs.createdAt))
    .limit(parsed.limit)
}

const actionInputSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid().optional(),
  actorId: z.string().uuid(),
  actorRole: z.string().min(1).max(40),
  note: z.string().max(200).optional(),
}).strict()

export type NotificationJobActionInput = z.input<typeof actionInputSchema>

export type NotificationJobActionResult =
  | { ok: true; id: string; state: "pending" | "cancelled" }
  | { ok: false; reason: "not_found" | "not_dead_lettered" }

/**
 * Requeue a dead-lettered job. Attempts are reset deliberately: the operator is
 * vouching that the cause was fixed, so the bounded ladder starts again from a
 * clean slate. The state predicate makes a concurrent retry a no-op instead of
 * a double reset.
 */
export async function retryNotificationJob(input: NotificationJobActionInput): Promise<NotificationJobActionResult> {
  const parsed = actionInputSchema.parse(input)
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        id: notificationJobs.id,
        tenantId: notificationJobs.tenantId,
        eventId: notificationJobs.eventId,
        recipientUserId: notificationJobs.recipientUserId,
        state: notificationJobs.state,
        attempts: notificationJobs.attempts,
        lastError: notificationJobs.lastError,
      })
      .from(notificationJobs)
      .where(and(eq(notificationJobs.id, parsed.id), tenantScope(parsed.tenantId)))
      .for("update")
      .limit(1)
    if (!row) return { ok: false, reason: "not_found" }
    if (row.state !== "dead_lettered") return { ok: false, reason: "not_dead_lettered" }

    const [updated] = await tx.update(notificationJobs)
      .set({
        state: "pending",
        attempts: 0,
        leaseToken: null,
        lastError: null,
        resolvedAt: null,
        nextAttemptAt: new Date(),
      })
      .where(and(eq(notificationJobs.id, row.id), eq(notificationJobs.state, "dead_lettered")))
      .returning({ id: notificationJobs.id, state: notificationJobs.state })
    if (!updated) return { ok: false, reason: "not_dead_lettered" }

    await tx.insert(auditLogs).values({
      requestId: randomUUID(),
      tenantId: row.tenantId,
      actorId: parsed.actorId,
      actorRole: parsed.actorRole,
      method: "NOTIFICATION_JOB_RETRY",
      path: `/api/admin/notification-jobs/${row.id}`,
      statusCode: "200",
      payload: {
        jobId: row.id,
        eventId: row.eventId,
        recipientUserId: row.recipientUserId,
        previousAttempts: row.attempts,
        previousError: row.lastError,
      },
    })
    return { ok: true, id: updated.id, state: "pending" as const }
  })
}

/**
 * Resolve a dead-lettered job WITHOUT sending. This is the honest terminal
 * outcome for a notice an operator decides should not be retried (for example,
 * a deleted recipient): the row stays as evidence, with a readable reason.
 */
export async function resolveNotificationJob(input: NotificationJobActionInput): Promise<NotificationJobActionResult> {
  const parsed = actionInputSchema.parse(input)
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        id: notificationJobs.id,
        tenantId: notificationJobs.tenantId,
        eventId: notificationJobs.eventId,
        recipientUserId: notificationJobs.recipientUserId,
        state: notificationJobs.state,
        attempts: notificationJobs.attempts,
        lastError: notificationJobs.lastError,
      })
      .from(notificationJobs)
      .where(and(eq(notificationJobs.id, parsed.id), tenantScope(parsed.tenantId)))
      .for("update")
      .limit(1)
    if (!row) return { ok: false, reason: "not_found" }
    if (row.state !== "dead_lettered") return { ok: false, reason: "not_dead_lettered" }

    const reason = parsed.note?.trim() ? `operator_resolved: ${parsed.note.trim()}` : "operator_resolved"
    const [updated] = await tx.update(notificationJobs)
      .set({ state: "cancelled", leaseToken: null, lastError: reason, resolvedAt: new Date() })
      .where(and(eq(notificationJobs.id, row.id), eq(notificationJobs.state, "dead_lettered")))
      .returning({ id: notificationJobs.id, state: notificationJobs.state })
    if (!updated) return { ok: false, reason: "not_dead_lettered" }

    await tx.insert(auditLogs).values({
      requestId: randomUUID(),
      tenantId: row.tenantId,
      actorId: parsed.actorId,
      actorRole: parsed.actorRole,
      method: "NOTIFICATION_JOB_RESOLVED",
      path: `/api/admin/notification-jobs/${row.id}`,
      statusCode: "200",
      payload: {
        jobId: row.id,
        eventId: row.eventId,
        recipientUserId: row.recipientUserId,
        previousAttempts: row.attempts,
        previousError: row.lastError,
        note: parsed.note?.trim() || null,
      },
    })
    return { ok: true, id: updated.id, state: "cancelled" as const }
  })
}
