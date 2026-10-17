import { randomUUID } from "crypto"
import { db, fanReactions, users, auditLogs } from "@mtk/database"
import { and, eq, desc } from "drizzle-orm"
import { z } from "zod"
import { isFanReactionType, type FanReactionType } from "@mtk/database/lib/fan-reaction-policy"
import { requireActiveLeagueContext } from "@/lib/league-reads"

/**
 * FAN-01 owner reaction moderation (locked writer).
 *
 * Reactions are engagement-only and the public surface shows AGGREGATE counts
 * (never per-fan rows), so there is deliberately no fan-facing "report this
 * reaction" affordance - a fan cannot see an individual reaction to report,
 * and pretending otherwise would fabricate visibility that does not exist.
 * Moderation is therefore an OWNER surface: the league owner may inspect the
 * individual reaction rows on their match (moderation necessity - they own the
 * league's engagement) and remove one. Every removal is audited; the public
 * aggregate counts simply fall when the row goes.
 */

export const REACTION_MODERATION_LIMIT = 100

const removeInputSchema = z.object({
  matchId: z.string().uuid(),
  reactionId: z.string().uuid(),
}).strict()

export type ModeratableReaction = {
  id: string
  reaction: FanReactionType
  fanName: string | null
  createdAt: string
}

/** Bounded newest-first moderation read; dead accounts drop out of the view. */
export async function readMatchReactionsForModeration(
  matchIdInput: unknown,
): Promise<ModeratableReaction[]> {
  const { matchId } = z.object({ matchId: z.string().uuid() }).strict().parse(
    typeof matchIdInput === "string" ? { matchId: matchIdInput } : matchIdInput,
  )
  const { tenantId } = await requireActiveLeagueContext("match:update")
  const rows = await db
    .select({
      id: fanReactions.id,
      reaction: fanReactions.reaction,
      fanName: users.displayName,
      createdAt: fanReactions.createdAt,
    })
    .from(fanReactions)
    .innerJoin(users, and(eq(users.id, fanReactions.userId), eq(users.isActive, true)))
    .where(and(eq(fanReactions.tenantId, tenantId), eq(fanReactions.matchId, matchId)))
    .orderBy(desc(fanReactions.createdAt))
    .limit(REACTION_MODERATION_LIMIT)
  return rows.flatMap(row => isFanReactionType(row.reaction)
    ? [{
        id: row.id,
        reaction: row.reaction,
        fanName: row.fanName ?? null,
        createdAt: row.createdAt.toISOString(),
      }]
    : [])
}

export type RemoveReactionResult = { removed: true } | { removed: false; reason: "not_found" }

/**
 * Remove one reaction of this league's match. Tenant, match and reaction are
 * all pinned in the locked read, so a foreign id simply reads as not found -
 * removal authority can never be widened across leagues, and a replay after a
 * successful removal reports honestly that the row is already gone.
 */
export async function removeFanReaction(input: unknown): Promise<RemoveReactionResult> {
  const parsed = removeInputSchema.parse(input)
  const { tenantId, actorId, role } = await requireActiveLeagueContext("match:update")

  return db.transaction(async tx => {
    const [row] = await tx
      .select({ id: fanReactions.id, userId: fanReactions.userId, reaction: fanReactions.reaction })
      .from(fanReactions)
      .where(and(
        eq(fanReactions.id, parsed.reactionId),
        eq(fanReactions.tenantId, tenantId),
        eq(fanReactions.matchId, parsed.matchId),
      ))
      .for("update")
      .limit(1)
    if (!row) return { removed: false, reason: "not_found" as const }

    await tx.delete(fanReactions).where(eq(fanReactions.id, row.id))
    await tx.insert(auditLogs).values({
      requestId: randomUUID(),
      tenantId,
      actorId,
      actorRole: role,
      method: "REACTION_REMOVE",
      path: `/dashboard/matches/${parsed.matchId}`,
      statusCode: "200",
      // Moderator-action provenance: what went, from whom (id only - the fan's
      // name is not copied into the audit), under which match.
      payload: { matchId: parsed.matchId, reactionId: row.id, reaction: row.reaction, fanUserId: row.userId },
    })
    return { removed: true } as const
  })
}
