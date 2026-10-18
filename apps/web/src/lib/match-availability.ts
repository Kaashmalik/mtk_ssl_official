import { randomUUID } from "crypto"
import {
  auditLogs,
  db,
  matchAvailability,
  matches,
  membershipGrantsAccess,
  userTenantRoles,
  users,
} from "@mtk/database"
import { and, asc, eq } from "drizzle-orm"
import { sql } from "drizzle-orm"
import { z } from "zod"
import { auth } from "@clerk/nextjs/server"
import { availabilityDecision, isAvailabilityStatus, type AvailabilityStatus } from "@mtk/database/lib/match-availability-policy"

/**
 * REG-05 (Batch 138): the self-service availability journey. A member of
 * the match's league records their own availability; re-answering updates
 * the same row in place (one row per match+person), an identical replay is
 * a pure read, and the write is audited. Terminal matches refuse - an
 * availability answer after the fact would be theatre. Roster identity
 * mapping stays with the roster/registration flows.
 */

const memberContextOf = async (clerkId: string) => {
  const [account] = await db
    .select({ id: users.id, isActive: users.isActive })
    .from(users)
    .where(eq(users.clerkId, clerkId))
    .limit(1)
  if (!account || account.isActive !== true) throw new Error("Forbidden: your account is unavailable")
  return account
}

const activeMembershipIn = async (
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  userId: string,
  tenantId: string,
) => {
  const [member] = await tx
    .select({ role: userTenantRoles.role, status: userTenantRoles.status, expiresAt: userTenantRoles.expiresAt })
    .from(userTenantRoles)
    .where(and(eq(userTenantRoles.userId, userId), eq(userTenantRoles.tenantId, tenantId)))
    .limit(1)
  if (!member || !membershipGrantsAccess(member)) throw new Error("Forbidden: you are not an active member of this league")
  return member
}

export async function setMyAvailability(
  matchId: string,
  status: string,
): Promise<{ recorded: true; status: AvailabilityStatus; changed: boolean }> {
  if (!isAvailabilityStatus(status)) throw new Error("Availability must be available, unavailable, or maybe")
  const { userId: clerkId } = await auth()
  if (!clerkId) throw new Error("Unauthorized")
  const account = await memberContextOf(clerkId)
  z.string().uuid().parse(matchId)

  return db.transaction(async (tx) => {
    // The match row is fetched by primary key alone; the league authority
    // is the row's OWN tenant_id and every write is gated by an ACTIVE
    // membership in exactly that league below - a non-member can read no
    // further than this existence check and can never write.
    const [match] = await tx
      .select({ id: matches.id, tenantId: matches.tenantId, status: matches.status })
      .from(matches)
      .where(eq(matches.id, matchId))
      .limit(1)
    if (!match) throw new Error("Match not found")
    const decision = availabilityDecision(match)
    if (!decision.ok) throw new Error(decision.reason)
    await activeMembershipIn(tx, account.id, match.tenantId)

    await tx.execute(sql`SELECT ${matchAvailability.id} FROM ${matchAvailability}
      WHERE ${matchAvailability.matchId} = ${match.id} AND ${matchAvailability.userId} = ${account.id} FOR UPDATE`)
    const [current] = await tx
      .select({ id: matchAvailability.id, status: matchAvailability.status })
      .from(matchAvailability)
      .where(and(eq(matchAvailability.matchId, match.id), eq(matchAvailability.userId, account.id)))
      .limit(1)

    if (current && current.status === status) {
      // Identical replay: a pure read - no second audit row, no fake update.
      return { recorded: true, status, changed: false }
    }

    if (current) {
      await tx
        .update(matchAvailability)
        .set({ status, recordedAt: new Date(), updatedAt: new Date() })
        .where(eq(matchAvailability.id, current.id))
    } else {
      await tx.insert(matchAvailability).values({ tenantId: match.tenantId, matchId: match.id, userId: account.id, status })
    }
    await tx.insert(auditLogs).values({
      requestId: randomUUID(),
      tenantId: match.tenantId,
      actorId: account.id,
      actorRole: null,
      method: "MATCH_AVAILABILITY_RECORDED",
      path: "/dashboard/matches",
      statusCode: "200",
      payload: { resourceId: match.id, status, replay: current ? "updated" : "first" },
    })
    return { recorded: true, status, changed: true }
  }, { isolationLevel: "read committed" })
}

/** Owner/manager read: bounded recorded answers with the person's name. */
export async function readMatchAvailabilitySummary(matchId: string, tenantId: string) {
  return db
    .select({
      userId: matchAvailability.userId,
      displayName: users.displayName,
      status: matchAvailability.status,
      recordedAt: matchAvailability.recordedAt,
    })
    .from(matchAvailability)
    .innerJoin(users, eq(users.id, matchAvailability.userId))
    .where(and(eq(matchAvailability.matchId, matchId), eq(matchAvailability.tenantId, tenantId)))
    .orderBy(asc(matchAvailability.recordedAt))
    .limit(100)
}

/**
 * The session's own recorded answer for a match (page-initial state for the
 * availability card). Two reads: the account by Clerk identity (identity
 * resolution is inherently global - it reads exactly one thing: the
 * session's own account), and the answer TENANT-SCOPED like every other
 * business read, so a forged matchId in a foreign league returns no row.
 */
export async function readMyAvailability(
  matchId: string,
  tenantId: string,
): Promise<{ userId: string; status: AvailabilityStatus | null }> {
  const { userId: clerkId } = await auth()
  if (!clerkId) return { userId: "", status: null }
  const [account] = await db
    .select({ id: users.id, isActive: users.isActive })
    .from(users)
    .where(eq(users.clerkId, clerkId))
    .limit(1)
  // A deactivated account simply has no answer to show - the self-READ never
  // refuses, only the WRITE filters.
  if (!account || account.isActive !== true) return { userId: "", status: null }
  const [row] = await db
    .select({ status: matchAvailability.status })
    .from(matchAvailability)
    .where(and(
      eq(matchAvailability.matchId, matchId),
      eq(matchAvailability.tenantId, tenantId),
      eq(matchAvailability.userId, account.id),
    ))
    .limit(1)
  return { userId: account.id, status: row && isAvailabilityStatus(row.status) ? row.status : null }
}
