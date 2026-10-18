import { randomUUID } from "crypto"
import { db, tournaments, auditLogs, type Tournament, type NewTournament } from "@mtk/database"
import { and, eq, sql } from "drizzle-orm"
import { z } from "zod"
import { lockOwnerContext } from "./tournament-lifecycle"

function lockTournamentRow(id: string, tenantId: string) {
  return sql`SELECT ${tournaments.id} FROM ${tournaments}
    WHERE ${and(eq(tournaments.id, id), eq(tournaments.tenantId, tenantId))} FOR UPDATE`
}

/** PostgreSQL unique_violation. The only unique key on tournaments is (tenant_id, slug). */
export function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: string }).code === "23505"
}

/**
 * True when the 23505 came from the creation-request-key index (the DB
 * names the constraint in the error message) rather than the slug unique.
 * A lost race on the key is a recovery, not a duplicate-slug refusal.
 */
export function isCreationKeyViolation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "")
  return message.includes("tournaments_tenant_creation_key_uq")
}

const DUPLICATE_SLUG = "A tournament with that web address already exists in this league"

/**
 * Creates a tournament in the exact active league as a locked, audited write.
 * The slug is unique per league (both a pre-check and the unique-violation catch
 * produce a friendly error); the insert and its audit share one transaction so a
 * failed audit aborts the create. This is not a quota/entitlement workflow.
 */
export async function createTournamentRecord(
  clerkId: string,
  tenantId: string,
  values: Omit<NewTournament, "id" | "tenantId" | "createdBy" | "createdAt" | "updatedAt">,
  /**
   * COMP-03 (Batch 136): client-supplied idempotency key for creation
   * recovery. A retried create carrying the SAME key (the wizard persists
   * it inside its durable draft) replays the first tournament instead of
   * duplicating it - pre-checked under the owner lock, and the DB partial
   * unique covers the lost race where a concurrent identical create wins.
   */
  creationRequestKey: string | null = null,
): Promise<Tournament> {
  if (creationRequestKey !== null) z.string().uuid().parse(creationRequestKey)
  return db.transaction(async (tx) => {
    const context = await lockOwnerContext(tx, clerkId, tenantId)

    if (creationRequestKey) {
      const replayed = await tx.query.tournaments.findFirst({ where: and(
        eq(tournaments.tenantId, tenantId), eq(tournaments.creationRequestKey, creationRequestKey)) })
      // Replay is a pure read: no duplicate audit, no slug fight.
      if (replayed) return replayed as Tournament
    }

    const clash = await tx.query.tournaments.findFirst({ where: and(
      eq(tournaments.tenantId, tenantId), eq(tournaments.slug, values.slug)) })
    if (clash) throw new Error(DUPLICATE_SLUG)

    try {
      const [created] = await tx.insert(tournaments)
        .values({ ...values, tenantId, createdBy: context.actor.id, ...(creationRequestKey ? { creationRequestKey } : {}) })
        .returning()
      if (!created) throw new Error("Tournament could not be created. Please try again.")
      await tx.insert(auditLogs).values({ requestId: randomUUID(), tenantId, actorId: context.actor.id,
        actorRole: context.member.role, method: "TOURNAMENT_CREATE", path: "/dashboard/tournaments",
        statusCode: "200", payload: { resourceId: created.id, changedFields: Object.keys(values) } })
      return created as Tournament
    } catch (error) {
      if (isUniqueViolation(error)) {
        // A lost creation race on the request key is a successful recovery:
        // the concurrent create with the same key won, so its tournament is
        // the honest answer. Only a foreign key index means a slug fight.
        if (creationRequestKey && isCreationKeyViolation(error)) {
          const winner = await tx.query.tournaments.findFirst({ where: and(
            eq(tournaments.tenantId, tenantId), eq(tournaments.creationRequestKey, creationRequestKey)) })
          if (winner) return winner as Tournament
        }
        throw new Error(DUPLICATE_SLUG)
      }
      throw error
    }
  }, { isolationLevel: "read committed" })
}

/** Validate dependent settings against the locked row, then return the update values. */
export type TournamentUpdatePrepare = (existing: Tournament) => Record<string, unknown>

/**
 * Updates a tournament in the exact active league as a locked, audited write. The
 * row is locked after the account -> league -> membership locks, the current owner
 * is rechecked after the wait, and a renamed slug is checked for uniqueness. The
 * update and its audit share one transaction.
 */
export async function updateTournamentRecord(
  clerkId: string,
  tenantId: string,
  id: string,
  prepare: TournamentUpdatePrepare,
): Promise<Tournament> {
  z.string().uuid().parse(id)
  return db.transaction(async (tx) => {
    const context = await lockOwnerContext(tx, clerkId, tenantId)
    await tx.execute(lockTournamentRow(id, tenantId))
    const existing = await tx.query.tournaments.findFirst({ where: and(
      eq(tournaments.id, id), eq(tournaments.tenantId, tenantId)) })
    if (!existing || existing.id !== id || existing.tenantId !== tenantId) throw new Error("Tournament not found")

    const values = prepare(existing)
    if (typeof values.slug === "string" && values.slug !== existing.slug) {
      const clash = await tx.query.tournaments.findFirst({ where: and(
        eq(tournaments.tenantId, tenantId), eq(tournaments.slug, values.slug)) })
      if (clash && clash.id !== id) throw new Error(DUPLICATE_SLUG)
    }

    try {
      const [updated] = await tx.update(tournaments).set({ ...values, updatedAt: new Date() })
        .where(and(eq(tournaments.id, id), eq(tournaments.tenantId, tenantId))).returning()
      if (!updated) throw new Error("Tournament changed. Reload before updating.")
      await tx.insert(auditLogs).values({ requestId: randomUUID(), tenantId, actorId: context.actor.id,
        actorRole: context.member.role, method: "TOURNAMENT_UPDATE", path: `/dashboard/tournaments/${id}`,
        statusCode: "200", payload: { resourceId: id, changedFields: Object.keys(values) } })
      return updated as Tournament
    } catch (error) {
      if (isUniqueViolation(error)) throw new Error(DUPLICATE_SLUG)
      throw error
    }
  }, { isolationLevel: "read committed" })
}
