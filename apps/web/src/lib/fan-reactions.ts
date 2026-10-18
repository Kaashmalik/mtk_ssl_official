import { db, fanReactions, matches, tournaments, users } from "@mtk/database"
import { and, eq, count, gte } from "drizzle-orm"
import { z } from "zod"
import {
  FAN_REACTION_TYPES, isFanReactionType, reactionRateDecision,
  reactionTargetDecision, FAN_REACTION_WINDOW_MS, type FanReactionType,
} from "@mtk/database/lib/fan-reaction-policy"
import { requireFanContext, FanContext } from "./fan-follows"
import { readActiveFanBlockExists } from "./fan-block-records"

/**
 * FAN-01 moderated fan reactions (locked writer).
 *
 * Identity/permission gate first (`requireFanContext`, exactly the active
 * league with `fan:follow`), then the shared publication/status policy for the
 * target match, then the flood floor, and only then the toggle (unique index
 * makes a duplicate insert a no-op under a race). Reactions are engagement
 * only: no scoring, standings or award path reads them.
 */

export { FAN_REACTION_TYPES, FAN_REACTION_LABELS } from "@mtk/database/lib/fan-reaction-policy"

export type FanReactionToggleResult = {
  action: "added" | "removed" | "refused"
  reason?:
    | "target_unpublished"
    | "rate_limited"
    | "unknown_reaction"
    | "blocked"
  /** Fresh counts after a successful toggle; absent when refused. */
  counts?: Record<FanReactionType, number>
}

const toggleInputSchema = z.object({
  matchId: z.string().uuid(),
  reaction: z.string().refine(isFanReactionType, "Unknown reaction"),
})

/**
 * Read the published/played-state of the target match in the same league.
 * Tenant is pinned on both joins - a foreign match id reads as unpublished.
 */
async function readReactionTarget(tenantId: string, matchId: string) {
  const [row] = await db
    .select({ status: matches.status, tournamentStatus: tournaments.status })
    .from(matches)
    .innerJoin(tournaments, and(eq(tournaments.id, matches.tournamentId), eq(tournaments.tenantId, tenantId)))
    .where(and(eq(matches.id, matchId), eq(matches.tenantId, tenantId)))
    .limit(1)
  return row ?? null
}

/** Fresh per-type counts for one match, bounded to the fixed reaction set. */
export async function readFanReactionCounts(
  tenantId: string,
  matchId: string,
): Promise<Record<FanReactionType, number>> {
  z.string().uuid().parse(tenantId)
  z.string().uuid().parse(matchId)
  const rows = await db
    .select({ reaction: fanReactions.reaction, total: count() })
    .from(fanReactions)
    .where(and(eq(fanReactions.tenantId, tenantId), eq(fanReactions.matchId, matchId)))
    .groupBy(fanReactions.reaction)
  const counts = Object.fromEntries(
    FAN_REACTION_TYPES.map(type => [type, 0]),
  ) as Record<FanReactionType, number>
  for (const row of rows) {
    if (isFanReactionType(row.reaction)) counts[row.reaction] = Number(row.total)
  }
  return counts
}

/** The signed-in fan's active reaction types for one match. */
export async function readMyFanReactions(tenantId: string, matchId: string): Promise<FanReactionType[]> {
  z.string().uuid().parse(tenantId)
  z.string().uuid().parse(matchId)
  const context = await requireFanContext("fan:follow")
  if (context.tenantId !== tenantId) return []
  const rows = await db
    .select({ reaction: fanReactions.reaction })
    .from(fanReactions)
    .innerJoin(users, and(eq(users.id, fanReactions.userId), eq(users.isActive, true)))
    .where(and(
      eq(fanReactions.tenantId, tenantId),
      eq(fanReactions.matchId, matchId),
      eq(fanReactions.userId, context.actorId),
    ))
  return rows.map(row => row.reaction).filter(isFanReactionType)
}

/**
 * Toggle the fan's reaction of one type on one published match. Adding is
 * rate-limited (anti-flood); removing never is, because deleting is not
 * abuse. Returns fresh counts so the UI never shows a stale number.
 */
export async function toggleFanReaction(
  input: unknown,
): Promise<FanReactionToggleResult> {
  const parsed = toggleInputSchema.parse(input)
  const reaction = parsed.reaction as FanReactionType
  const context: FanContext = await requireFanContext("fan:follow")

  // (0) Anti-abuse gate: a league-scoped active block refuses this fan's
  // contribution fail-closed, before any target or rate logic runs.
  if (await readActiveFanBlockExists(context.tenantId, context.actorId)) {
    return { action: "refused", reason: "blocked" }
  }

  // (1) Target gate: published tournament, published, never-cancelled match.
  const target = await readReactionTarget(context.tenantId, parsed.matchId)
  const decision = target
    ? reactionTargetDecision({ matchStatus: target.status, tournamentStatus: target.tournamentStatus })
    : { allowed: false as const, reason: "target_unpublished" as const }
  if (!decision.allowed) return { action: "refused", reason: decision.reason }

  // (2) Anti-flood floor on ADDS (a removal is never rate-limited).
  const [existing] = await db
    .select({ id: fanReactions.id })
    .from(fanReactions)
    .where(and(
      eq(fanReactions.tenantId, context.tenantId),
      eq(fanReactions.matchId, parsed.matchId),
      eq(fanReactions.userId, context.actorId),
      eq(fanReactions.reaction, reaction),
    ))
    .limit(1)

  if (existing) {
    await db.delete(fanReactions).where(eq(fanReactions.id, existing.id))
  } else {
    const windowStart = new Date(Date.now() - FAN_REACTION_WINDOW_MS)
    const [recent] = await db
      .select({ total: count() })
      .from(fanReactions)
      .where(and(
        eq(fanReactions.tenantId, context.tenantId),
        eq(fanReactions.userId, context.actorId),
        gte(fanReactions.createdAt, windowStart),
      ))
      .limit(1)
    const rate = reactionRateDecision(Number(recent.total))
    if (!rate.allowed) return { action: "refused", reason: "rate_limited" }
    await db.insert(fanReactions).values({
      tenantId: context.tenantId,
      matchId: parsed.matchId,
      userId: context.actorId,
      reaction,
    }).onConflictDoNothing()
  }

  const counts = await readFanReactionCounts(context.tenantId, parsed.matchId)
  return {
    action: existing ? "removed" : "added",
    counts,
  }
}
