import { randomUUID } from "crypto"
import { db, fanBlocks, users, auditLogs } from "@mtk/database"
import { and, eq, desc } from "drizzle-orm"
import { z } from "zod"
import {
  isFanBlockReason,
  fanBlockLiftDecision,
  fanBlockEnforcement,
  type FanBlockReason,
} from "@mtk/database/lib/fan-reaction-policy"
import { requireActiveLeagueContext } from "./league-reads"

/**
 * FAN-01 anti-abuse slice (locked writer): LEAGUE-SCOPED fan interaction
 * blocks. The league owner stops one fan from reacting to or reporting on
 * any match of THEIR league - the tenant is pinned on every path, so a
 * foreign fan id simply cannot be blocked into another league and a foreign
 * block row reads as not found. Identity/permission gate first
 * (`requireActiveLeagueContext`, exactly `match:update` like the rest of the
 * moderation surface), then the partial unique index makes a re-block while
 * active an idempotent no-op; a lift is a locked update carrying reviewer
 * provenance in the same transaction as its audit (the DB lift CHECK mirrors
 * this). Lifted history is kept - a re-block after a lift is a NEW active
 * row, so provenance survives in both directions.
 *
 * Blocks are anti-abuse signals only: no scoring, standings or award path
 * reads them, and they never grant anything.
 */

const blockInputSchema = z.object({
  fanUserId: z.string().uuid(),
  reason: z.string().refine(isFanBlockReason, "Unknown reason").default("report_abuse"),
})

const liftInputSchema = z.object({
  fanUserId: z.string().uuid(),
})

export type FanBlockResult =
  | { action: "blocked" }
  | { action: "already_blocked" }
  | { action: "refused"; reason: "invalid_reason" }

export type FanBlockRow = {
  fanUserId: string
  fanName: string | null
  reason: string
  createdAt: string
}

/**
 * Organizer-side existence probe reused by the engagement writers: an
 * ACTIVE league-scoped block on this fan (fail-closed to false on any read
 * error is WRONG here - fail closed for enforcement means REFUSE on true
 * only; an error propagates so the writer's own error handling decides,
 * exactly like every other gate read).
 */
export async function readActiveFanBlockExists(tenantId: string, fanUserId: string): Promise<boolean> {
  z.string().uuid().parse(tenantId)
  z.string().uuid().parse(fanUserId)
  const [row] = await db
    .select({ id: fanBlocks.id })
    .from(fanBlocks)
    .where(and(
      eq(fanBlocks.tenantId, tenantId),
      eq(fanBlocks.blockedUserId, fanUserId),
      eq(fanBlocks.status, "active"),
    ))
    .limit(1)
  return fanBlockEnforcement(Boolean(row)).blocked
}

/** Block one fan's reaction/report participation across this whole league. */
export async function blockFanInteraction(input: unknown): Promise<FanBlockResult> {
  const parsed = blockInputSchema.parse(input)
  const { tenantId, actorId, role } = await requireActiveLeagueContext("match:update")

  const inserted = await db
    .insert(fanBlocks)
    .values({
      tenantId,
      blockedUserId: parsed.fanUserId,
      blockedBy: actorId,
      reason: parsed.reason as FanBlockReason,
    })
    .onConflictDoNothing()
    .returning({ id: fanBlocks.id })

  if (inserted.length === 0) return { action: "already_blocked" }

  await db.insert(auditLogs).values({
    requestId: randomUUID(),
    tenantId,
    actorId,
    actorRole: role,
    method: "FAN_BLOCK",
    path: "/dashboard/settings",
    statusCode: "200",
    // Block provenance: which fan (id only - the name is not copied into
    // the audit), why, league-scoped.
    payload: { blockedUserId: parsed.fanUserId, reason: parsed.reason, scope: "league" },
  })

  return { action: "blocked" }
}

export type FanLiftResult =
  | { lifted: true }
  | { lifted: false; reason: "not_found" | "already_lifted" }

/** Lift the fan's active block. History stays; a re-block is a new row. */
export async function liftFanBlock(input: unknown): Promise<FanLiftResult> {
  const parsed = liftInputSchema.parse(input)
  const { tenantId, actorId, role } = await requireActiveLeagueContext("match:update")

  return db.transaction(async tx => {
    const [block] = await tx
      .select({ id: fanBlocks.id, status: fanBlocks.status })
      .from(fanBlocks)
      .where(and(
        eq(fanBlocks.tenantId, tenantId),
        eq(fanBlocks.blockedUserId, parsed.fanUserId),
        eq(fanBlocks.status, "active"),
      ))
      .for("update")
      .limit(1)
    if (!block) return { lifted: false, reason: "not_found" as const }

    const outcome = fanBlockLiftDecision({ currentStatus: block.status as "active" | "lifted" })
    if (!outcome.allowed) return { lifted: false, reason: outcome.reason }

    await tx
      .update(fanBlocks)
      .set({ status: "lifted", liftedBy: actorId, liftedAt: new Date() })
      .where(eq(fanBlocks.id, block.id))

    await tx.insert(auditLogs).values({
      requestId: randomUUID(),
      tenantId,
      actorId,
      actorRole: role,
      method: "FAN_BLOCK_LIFT",
      path: "/dashboard/settings",
      statusCode: "200",
      // Lift provenance: which fan (id only), which block row.
      payload: { blockedUserId: parsed.fanUserId, blockId: block.id },
    })
    return { lifted: true } as const
  })
}

/** The league's currently blocked fans, bounded newest-first. */
export async function readActiveFanBlocks(): Promise<FanBlockRow[]> {
  const { tenantId } = await requireActiveLeagueContext("match:update")
  const rows = await db
    .select({
      fanUserId: fanBlocks.blockedUserId,
      fanName: users.displayName,
      reason: fanBlocks.reason,
      createdAt: fanBlocks.createdAt,
    })
    .from(fanBlocks)
    .innerJoin(users, and(eq(users.id, fanBlocks.blockedUserId), eq(users.isActive, true)))
    .where(and(eq(fanBlocks.tenantId, tenantId), eq(fanBlocks.status, "active")))
    .orderBy(desc(fanBlocks.createdAt))
    .limit(50)
  return rows.map(row => ({
    fanUserId: row.fanUserId,
    fanName: row.fanName ?? null,
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
  }))
}
