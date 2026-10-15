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
): Promise<Tournament> {
  return db.transaction(async (tx) => {
    const context = await lockOwnerContext(tx, clerkId, tenantId)

    const clash = await tx.query.tournaments.findFirst({ where: and(
      eq(tournaments.tenantId, tenantId), eq(tournaments.slug, values.slug)) })
    if (clash) throw new Error(DUPLICATE_SLUG)

    try {
      const [created] = await tx.insert(tournaments)
        .values({ ...values, tenantId, createdBy: context.actor.id }).returning()
      if (!created) throw new Error("Tournament could not be created. Please try again.")
      await tx.insert(auditLogs).values({ requestId: randomUUID(), tenantId, actorId: context.actor.id,
        actorRole: context.member.role, method: "TOURNAMENT_CREATE", path: "/dashboard/tournaments",
        statusCode: "200", payload: { resourceId: created.id, changedFields: Object.keys(values) } })
      return created as Tournament
    } catch (error) {
      if (isUniqueViolation(error)) throw new Error(DUPLICATE_SLUG)
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
