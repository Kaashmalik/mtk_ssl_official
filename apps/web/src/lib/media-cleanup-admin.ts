import { randomUUID } from "node:crypto"
import { auditLogs, db, mediaCleanupJobs } from "@mtk/database"
import { and, desc, eq, type SQL } from "drizzle-orm"
import { z } from "zod"

/**
 * ENH-07-03: media cleanup dead-letter operations.
 *
 * A dead-lettered destruction means a tombstoned provider object may still
 * exist. Operators can inspect the head, deliberately requeue after fixing
 * credentials/quota (attempts reset), or resolve WITHOUT destroying and keep
 * the row as evidence. Both actions are audited. Retention is deliberate: the
 * job carries the provider identity even when the asset row is gone.
 */

export const MEDIA_CLEANUP_DEAD_LETTER_LIMIT = 100
export const MEDIA_CLEANUP_DEAD_LETTER_MAX_LIMIT = 200

const listInputSchema = z.object({
  tenantId: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(MEDIA_CLEANUP_DEAD_LETTER_MAX_LIMIT)
    .default(MEDIA_CLEANUP_DEAD_LETTER_LIMIT),
}).strict()

export type MediaCleanupDeadLetterListInput = z.input<typeof listInputSchema>

export type MediaCleanupDeadLetter = {
  id: string
  tenantId: string
  assetId: string | null
  provider: string
  providerPublicId: string
  providerResourceType: string
  action: string
  attempts: number
  lastError: string | null
  createdAt: Date
  resolvedAt: Date | null
}

function tenantScope(tenantId: string | undefined): SQL | undefined {
  return tenantId ? eq(mediaCleanupJobs.tenantId, tenantId) : undefined
}

export async function listMediaCleanupDeadLetters(
  input: MediaCleanupDeadLetterListInput = {},
): Promise<MediaCleanupDeadLetter[]> {
  const parsed = listInputSchema.parse(input)
  return db
    .select({
      id: mediaCleanupJobs.id,
      tenantId: mediaCleanupJobs.tenantId,
      assetId: mediaCleanupJobs.assetId,
      provider: mediaCleanupJobs.provider,
      providerPublicId: mediaCleanupJobs.providerPublicId,
      providerResourceType: mediaCleanupJobs.providerResourceType,
      action: mediaCleanupJobs.action,
      attempts: mediaCleanupJobs.attempts,
      lastError: mediaCleanupJobs.lastError,
      createdAt: mediaCleanupJobs.createdAt,
      resolvedAt: mediaCleanupJobs.resolvedAt,
    })
    .from(mediaCleanupJobs)
    .where(and(eq(mediaCleanupJobs.state, "dead_lettered"), tenantScope(parsed.tenantId)))
    .orderBy(desc(mediaCleanupJobs.createdAt))
    .limit(parsed.limit)
}

const actionInputSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid().optional(),
  actorId: z.string().uuid(),
  actorRole: z.string().min(1).max(40),
  note: z.string().max(200).optional(),
}).strict()

export type MediaCleanupActionInput = z.input<typeof actionInputSchema>

export type MediaCleanupActionResult =
  | { ok: true; id: string; state: "pending" | "failed" }
  | { ok: false; reason: "not_found" | "not_dead_lettered" }

/** Requeue a dead-lettered destruction with a clean retry ladder. */
export async function retryMediaCleanupJob(
  input: MediaCleanupActionInput,
): Promise<MediaCleanupActionResult> {
  const parsed = actionInputSchema.parse(input)
  return db.transaction(async tx => {
    const [row] = await tx
      .select({
        id: mediaCleanupJobs.id,
        tenantId: mediaCleanupJobs.tenantId,
        assetId: mediaCleanupJobs.assetId,
        providerPublicId: mediaCleanupJobs.providerPublicId,
        action: mediaCleanupJobs.action,
        state: mediaCleanupJobs.state,
        attempts: mediaCleanupJobs.attempts,
        lastError: mediaCleanupJobs.lastError,
      })
      .from(mediaCleanupJobs)
      .where(and(eq(mediaCleanupJobs.id, parsed.id), tenantScope(parsed.tenantId)))
      .for("update")
      .limit(1)
    if (!row) return { ok: false, reason: "not_found" }
    if (row.state !== "dead_lettered") return { ok: false, reason: "not_dead_lettered" }

    const [updated] = await tx.update(mediaCleanupJobs)
      .set({
        state: "pending",
        attempts: 0,
        leaseToken: null,
        lastError: null,
        resolvedAt: null,
        nextAttemptAt: new Date(),
      })
      .where(and(
        eq(mediaCleanupJobs.id, row.id),
        eq(mediaCleanupJobs.state, "dead_lettered"),
      ))
      .returning({ id: mediaCleanupJobs.id, state: mediaCleanupJobs.state })
    if (!updated) return { ok: false, reason: "not_dead_lettered" }

    await tx.insert(auditLogs).values({
      requestId: randomUUID(),
      tenantId: row.tenantId,
      actorId: parsed.actorId,
      actorRole: parsed.actorRole,
      method: "MEDIA_CLEANUP_RETRY",
      path: `/api/admin/media-cleanup-jobs/${row.id}`,
      statusCode: "200",
      payload: {
        jobId: row.id,
        assetId: row.assetId,
        providerPublicId: row.providerPublicId,
        action: row.action,
        previousAttempts: row.attempts,
        previousError: row.lastError,
      },
    })
    return { ok: true, id: updated.id, state: "pending" as const }
  })
}

/**
 * Resolve WITHOUT provider destruction. This does not pretend the object is
 * gone: state `failed` stays terminal and the reason records the decision.
 */
export async function resolveMediaCleanupJob(
  input: MediaCleanupActionInput,
): Promise<MediaCleanupActionResult> {
  const parsed = actionInputSchema.parse(input)
  return db.transaction(async tx => {
    const [row] = await tx
      .select({
        id: mediaCleanupJobs.id,
        tenantId: mediaCleanupJobs.tenantId,
        assetId: mediaCleanupJobs.assetId,
        providerPublicId: mediaCleanupJobs.providerPublicId,
        action: mediaCleanupJobs.action,
        state: mediaCleanupJobs.state,
        attempts: mediaCleanupJobs.attempts,
        lastError: mediaCleanupJobs.lastError,
      })
      .from(mediaCleanupJobs)
      .where(and(eq(mediaCleanupJobs.id, parsed.id), tenantScope(parsed.tenantId)))
      .for("update")
      .limit(1)
    if (!row) return { ok: false, reason: "not_found" }
    if (row.state !== "dead_lettered") return { ok: false, reason: "not_dead_lettered" }

    const reason = parsed.note?.trim()
      ? `operator_resolved: ${parsed.note.trim()}`
      : "operator_resolved"
    const [updated] = await tx.update(mediaCleanupJobs)
      .set({
        state: "failed",
        leaseToken: null,
        lastError: reason,
        resolvedAt: new Date(),
      })
      .where(and(
        eq(mediaCleanupJobs.id, row.id),
        eq(mediaCleanupJobs.state, "dead_lettered"),
      ))
      .returning({ id: mediaCleanupJobs.id, state: mediaCleanupJobs.state })
    if (!updated) return { ok: false, reason: "not_dead_lettered" }

    await tx.insert(auditLogs).values({
      requestId: randomUUID(),
      tenantId: row.tenantId,
      actorId: parsed.actorId,
      actorRole: parsed.actorRole,
      method: "MEDIA_CLEANUP_RESOLVED",
      path: `/api/admin/media-cleanup-jobs/${row.id}`,
      statusCode: "200",
      payload: {
        jobId: row.id,
        assetId: row.assetId,
        providerPublicId: row.providerPublicId,
        action: row.action,
        previousAttempts: row.attempts,
        previousError: row.lastError,
        note: parsed.note?.trim() || null,
      },
    })
    return { ok: true, id: updated.id, state: "failed" as const }
  })
}
