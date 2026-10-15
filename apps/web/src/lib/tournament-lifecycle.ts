import { randomUUID } from "crypto"
import { db, users, tenants, userTenantRoles, tournaments, auditLogs, type Tournament } from "@mtk/database"
import { and, eq, ne, sql } from "drizzle-orm"
import { z } from "zod"

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

// Archival locks account -> league -> membership -> tournament. It never takes a
// match lock, never hard-deletes and never cascades: registration history and
// match/team links are preserved. READ COMMITTED reads after waits recheck the
// current owner and status.
async function ownerContext(tx: Tx, clerkId: string, tenantId: string) {
  const initial = await tx.query.users.findFirst({ where: eq(users.clerkId, clerkId) })
  if (!initial) throw new Error("Forbidden: tournament account not found")
  await tx.execute(sql`SELECT ${users.id} FROM ${users} WHERE ${users.id} = ${initial.id} FOR UPDATE`)
  await tx.execute(sql`SELECT ${tenants.id} FROM ${tenants} WHERE ${tenants.id} = ${tenantId} FOR SHARE`)
  await tx.execute(sql`SELECT ${userTenantRoles.id} FROM ${userTenantRoles}
    WHERE ${and(eq(userTenantRoles.userId, initial.id), eq(userTenantRoles.tenantId, tenantId))} FOR SHARE`)
  const actor = await tx.query.users.findFirst({ where: eq(users.id, initial.id) })
  const league = await tx.query.tenants.findFirst({ where: eq(tenants.id, tenantId) })
  const member = await tx.query.userTenantRoles.findFirst({ where: and(
    eq(userTenantRoles.userId, initial.id), eq(userTenantRoles.tenantId, tenantId)) })
  if (!actor || actor.id !== initial.id || actor.clerkId !== clerkId || actor.isActive !== true
    || !league || league.id !== tenantId || league.isActive !== true
    || !member || member.userId !== actor.id || member.tenantId !== tenantId || member.status !== "active"
    || member.role !== "league_owner") {
    throw new Error("Forbidden: your tournament access changed")
  }
  return { actor, league, member }
}

/**
 * Retires a tournament by cancelling it instead of deleting it. Cancelled
 * tournaments keep their registrations, team links and match links; the UI labels
 * them as archived. A live tournament must have its matches finished/abandoned
 * first. This is not a purge, refund or slot-release workflow.
 */
export async function archiveTournament(clerkId: string, tenantId: string, id: string) {
  z.string().uuid().parse(id)
  return db.transaction(async (tx) => {
    const context = await ownerContext(tx, clerkId, tenantId)
    await tx.execute(sql`SELECT ${tournaments.id} FROM ${tournaments}
      WHERE ${and(eq(tournaments.id, id), eq(tournaments.tenantId, tenantId))} FOR UPDATE`)
    const tournament = await tx.query.tournaments.findFirst({ where: and(
      eq(tournaments.id, id), eq(tournaments.tenantId, tenantId)) })
    if (!tournament || tournament.id !== id || tournament.tenantId !== tenantId) throw new Error("Tournament not found")
    if (tournament.status === "cancelled") throw new Error("Tournament is already archived")
    if (tournament.status === "live") throw new Error("Finish or abandon the live matches before archiving this tournament")

    const [updated] = await tx.update(tournaments)
      .set({ status: "cancelled", registrationOpen: false, updatedAt: new Date() })
      .where(and(eq(tournaments.id, id), eq(tournaments.tenantId, tenantId), ne(tournaments.status, "cancelled"))).returning()
    if (!updated) throw new Error("Tournament changed. Reload before archiving.")
    await tx.insert(auditLogs).values({ requestId: randomUUID(), tenantId, actorId: context.actor.id,
      actorRole: context.member.role, method: "TOURNAMENT_ARCHIVE", path: `/dashboard/tournaments/${id}`,
      statusCode: "200", payload: { resourceId: id, before: { status: tournament.status },
        after: { status: "cancelled", registrationOpen: false }, changedFields: ["status", "registrationOpen"] } })
    return updated as Tournament
  }, { isolationLevel: "read committed" })
}
