import { randomUUID } from "crypto"
import { auth } from "@clerk/nextjs/server"
import { db, users, tenants, userTenantRoles, tournaments, auditLogs, membershipGrantsAccess } from "@mtk/database"
import { and, eq, sql } from "drizzle-orm"

/**
 * COMP-07 competition locks. Engagement is an explicit league decision:
 * this is the ONLY writer in the repo that sets or clears
 * `tournaments.competition_locked_at` (status transitions never touch it),
 * so the schema and the audits always tell the same story about what the
 * league actually decided.
 *
 * Enforcement sites (match management) derive the blocking decision from
 * the shared pure module under their own transactions; this writer only
 * places and lifts the lock.
 */

export type CompetitionLockResult = {
  tournamentId: string
  locked: boolean
  lockedAt: string | null
}

export async function setCompetitionLock(
  tournamentId: string,
  lock: boolean,
): Promise<CompetitionLockResult> {
  const { userId: clerkId } = await auth()
  if (!clerkId) throw new Error("Unauthorized")

  return db.transaction(async (tx) => {
    // Project lock ordering: actor -> league -> membership -> resource row.
    const [actorInitial] = await tx.select({ id: users.id }).from(users)
      .where(eq(users.clerkId, clerkId)).limit(1)
    if (!actorInitial) throw new Error("Forbidden: competition administration account not found")
    await tx.execute(sql`SELECT ${users.id} FROM ${users} WHERE ${users.id} = ${actorInitial.id} FOR UPDATE`)
    const [actor] = await tx.select({ id: users.id, isActive: users.isActive, clerkId: users.clerkId })
      .from(users).where(eq(users.id, actorInitial.id)).limit(1)
    if (!actor || actor.clerkId !== clerkId || actor.isActive !== true) {
      throw new Error("Forbidden: competition administration account unavailable")
    }

    const key = eq(tournaments.id, tournamentId)
    await tx.execute(sql`SELECT ${tournaments.id} FROM ${tournaments} WHERE ${key} FOR UPDATE`)
    const [tournament] = await tx.select({
      id: tournaments.id, tenantId: tournaments.tenantId, competitionLockedAt: tournaments.competitionLockedAt,
    }).from(tournaments).where(key).limit(1)
    if (!tournament || tournament.id !== tournamentId) throw new Error("Competition not found")
    const tenantId = tournament.tenantId

    await tx.execute(sql`SELECT ${tenants.id} FROM ${tenants} WHERE ${tenants.id} = ${tenantId} FOR SHARE`)
    const [league] = await tx.select({ id: tenants.id, isActive: tenants.isActive })
      .from(tenants).where(eq(tenants.id, tenantId)).limit(1)
    if (!league || league.isActive !== true) throw new Error("Forbidden: competition league unavailable")

    const memberKey = and(eq(userTenantRoles.userId, actor.id), eq(userTenantRoles.tenantId, tenantId))
    await tx.execute(sql`SELECT ${userTenantRoles.id} FROM ${userTenantRoles} WHERE ${memberKey} FOR SHARE`)
    const [member] = await tx.select({
      role: userTenantRoles.role, status: userTenantRoles.status, expiresAt: userTenantRoles.expiresAt,
    }).from(userTenantRoles).where(memberKey).limit(1)
    // settings:manage resolves to the league owner in this league (the
    // platform super admin holds no league memberships; the platform
    // console touches locks through audited support, not this surface).
    if (!member || member.role !== "league_owner" || !membershipGrantsAccess(member)) {
      throw new Error("Forbidden: only the league owner can change the competition lock")
    }

    // Idempotent replay of the requested state stays a read (same
    // precedent as an already-cancelled fixture) — no duplicate audit.
    const lockedNow = tournament.competitionLockedAt !== null
    if (lockedNow === lock) {
      return { tournamentId, locked: lockedNow, lockedAt: tournament.competitionLockedAt ? tournament.competitionLockedAt.toISOString() : null }
    }

    const lockedAt = lock ? new Date() : null
    const [updated] = await tx.update(tournaments)
      .set({
        competitionLockedAt: lockedAt,
        competitionLockedBy: lock ? actor.id : null,
        updatedAt: new Date(),
      })
      .where(key)
      .returning({ id: tournaments.id, competitionLockedAt: tournaments.competitionLockedAt })
    if (!updated || updated.id !== tournamentId) throw new Error("Competition changed. Reload before saving.")

    await tx.insert(auditLogs).values({
      requestId: randomUUID(), tenantId, actorId: actor.id, actorRole: member.role,
      method: lock ? "COMPETITION_LOCK" : "COMPETITION_UNLOCK",
      path: `/dashboard/tournaments/${tournamentId}`, statusCode: "200",
      payload: {
        tournamentId, lock,
        before: { competitionLockedAt: tournament.competitionLockedAt ? tournament.competitionLockedAt.toISOString() : null },
        after: { competitionLockedAt: updated.competitionLockedAt ? updated.competitionLockedAt.toISOString() : null },
      },
    })

    return { tournamentId, locked: lock, lockedAt: lockedAt ? lockedAt.toISOString() : null }
  }, { isolationLevel: "read committed" })
}
