"use server"

import { randomUUID } from "crypto"
import { auth } from "@clerk/nextjs/server"
import { revalidatePath } from "next/cache"
import { db, users, tenants, userTenantRoles, teams, matches, auditLogs } from "@mtk/database"
import { and, eq, inArray, or, sql } from "drizzle-orm"
import { z } from "zod"
import { getDashboardContext } from "@/lib/dashboard-context"
import { hasPermission } from "@/lib/rbac"

const editableRoles = ["team_manager", "coach", "scorer", "player", "fan"] as const
const memberKey = z.object({
  tenantId: z.string().uuid(),
  membershipId: z.string().uuid(),
  expectedVersion: z.number().int().min(0).max(2147483646),
})
const roleChange = memberKey.extend({ role: z.enum(editableRoles) }).strict()
const statusChange = memberKey.extend({ status: z.enum(["active", "suspended"]) }).strict()
const memberRemoval = memberKey.strict()
export type MemberRoleChange = z.infer<typeof roleChange>
export type MemberStatusChange = z.infer<typeof statusChange>
export type MemberRemoval = z.infer<typeof memberRemoval>

async function requireMemberManager() {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  const access = await getDashboardContext(userId)
  if (access.status !== "ready" || access.context.role !== "league_owner" || !hasPermission(access.context.role, "user:manage")) {
    throw new Error("Forbidden: league member management requires an active owner membership")
  }
  return access.context
}

/** Administrative contact details are owner-only, not team-manager user:read. */
export async function getUsers(expectedTenantId?: string) {
  const context = await requireMemberManager()
  if (expectedTenantId !== undefined && z.string().uuid().parse(expectedTenantId) !== context.tenantId) {
    throw new Error("Workspace changed. Reload members before viewing.")
  }
  return db.select({
    id: users.id, email: users.email, displayName: users.displayName,
    avatarUrl: users.avatarUrl, accountActive: users.isActive,
    protectedAccess: sql<boolean>`${users.role} = 'super_admin'`,
    membershipId: userTenantRoles.id, role: userTenantRoles.role,
    status: userTenantRoles.status, version: userTenantRoles.version,
    createdAt: userTenantRoles.createdAt,
  }).from(userTenantRoles).innerJoin(users, eq(users.id, userTenantRoles.userId))
    .where(eq(userTenantRoles.tenantId, context.tenantId))
    .orderBy(userTenantRoles.createdAt, userTenantRoles.id).limit(100)
}

async function changeMember(input: MemberRoleChange | MemberStatusChange) {
  const context = await requireMemberManager()
  if (input.tenantId !== context.tenantId) throw new Error("Workspace changed. Reload members before saving.")
  const member = await db.transaction(async (tx) => {
    const key = and(eq(userTenantRoles.id, input.membershipId), eq(userTenantRoles.tenantId, context.tenantId))
    const initial = await tx.query.userTenantRoles.findFirst({ where: key })
    if (!initial || initial.tenantId !== context.tenantId || initial.id !== input.membershipId) {
      throw new Error("Member not found in this league")
    }
    // Lock users in stable order, then league, then memberships. The scoring
    // service locks its actor before membership too. Do not lock matches here.
    const ids = [...new Set([context.actorId, initial.userId])].sort()
    await tx.execute(sql`SELECT ${users.id} FROM ${users} WHERE ${inArray(users.id, ids)} ORDER BY ${users.id} FOR UPDATE`)
    await tx.execute(sql`SELECT ${tenants.id} FROM ${tenants} WHERE ${tenants.id} = ${context.tenantId} FOR SHARE`)
    await tx.execute(sql`SELECT ${userTenantRoles.id} FROM ${userTenantRoles}
      WHERE ${and(eq(userTenantRoles.tenantId, context.tenantId), inArray(userTenantRoles.userId, ids))}
      ORDER BY ${userTenantRoles.id} FOR UPDATE`)

    const actor = await tx.query.users.findFirst({ where: eq(users.id, context.actorId) })
    const league = await tx.query.tenants.findFirst({ where: eq(tenants.id, context.tenantId) })
    const actorMember = await tx.query.userTenantRoles.findFirst({ where: and(
      eq(userTenantRoles.userId, context.actorId), eq(userTenantRoles.tenantId, context.tenantId),
    ) })
    if (!actor || actor.id !== context.actorId || actor.isActive !== true
      || !league || league.id !== context.tenantId || league.isActive !== true
      || !actorMember || actorMember.userId !== context.actorId || actorMember.tenantId !== context.tenantId
      || actorMember.status !== "active" || actorMember.role !== "league_owner") {
      throw new Error("Forbidden: your member-management access changed")
    }
    const target = await tx.query.userTenantRoles.findFirst({ where: key })
    const account = await tx.query.users.findFirst({ where: eq(users.id, initial.userId) })
    if (!target || target.id !== input.membershipId || target.tenantId !== context.tenantId
      || target.userId !== initial.userId || !account || account.id !== target.userId) {
      throw new Error("Member not found in this league")
    }
    // Ownership and platform authority are not editable in ordinary member CRUD.
    // Protect every owner, including the last one, until two-party transfer ships.
    if (target.userId === context.actorId || target.userId === league.ownerId
      || target.role === "league_owner" || target.role === "super_admin" || account.role === "super_admin") {
      throw new Error("Owner, platform and self access cannot be changed here")
    }
    if (target.version !== input.expectedVersion) throw new Error("Member changed. Reload before saving.")
    const changes = "role" in input ? { role: input.role } : { status: input.status }
    if (("role" in input && target.role === input.role) || ("status" in input && target.status === input.status)) {
      return { membershipId: target.id, role: target.role, status: target.status, version: target.version }
    }
    const [updated] = await tx.update(userTenantRoles).set(changes)
      .where(and(key, eq(userTenantRoles.version, input.expectedVersion)))
      .returning({ membershipId: userTenantRoles.id, role: userTenantRoles.role,
        status: userTenantRoles.status, version: userTenantRoles.version })
    if (!updated) throw new Error("Member changed. Reload before saving.")
    await tx.insert(auditLogs).values({
      requestId: randomUUID(), tenantId: context.tenantId, actorId: context.actorId,
      actorRole: actorMember.role, method: "MEMBERSHIP_CHANGE", path: "/dashboard/settings/members", statusCode: "200",
      payload: { membershipId: target.id, targetUserId: target.userId,
        before: { role: target.role, status: target.status, version: target.version }, after: updated },
    })
    return updated
  })
  revalidatePath("/dashboard", "layout")
  return { success: true as const, member }
}

export async function updateUserRole(input: MemberRoleChange) {
  return changeMember(roleChange.parse(input))
}

/** Historical name retained; this changes league membership, never the account. */
export async function toggleUserStatus(input: MemberStatusChange) {
  return changeMember(statusChange.parse(input))
}

/**
 * Remove a member from this league only. Historical players/statistics are not
 * deleted, and the global account is untouched. Removal is refused while the
 * member still holds an operational assignment (team manager or assigned
 * scorer) so a live match or team cannot be silently orphaned — the owner must
 * unassign first. Owner, self and platform memberships are protected.
 */
export async function removeMember(input: MemberRemoval) {
  const parsed = memberRemoval.parse(input)
  const context = await requireMemberManager()
  if (parsed.tenantId !== context.tenantId) throw new Error("Workspace changed. Reload members before saving.")
  await db.transaction(async (tx) => {
    const key = and(eq(userTenantRoles.id, parsed.membershipId), eq(userTenantRoles.tenantId, context.tenantId))
    const initial = await tx.query.userTenantRoles.findFirst({ where: key })
    if (!initial || initial.tenantId !== context.tenantId || initial.id !== parsed.membershipId) {
      throw new Error("Member not found in this league")
    }
    // Same lock order as membership edits: users, league, memberships.
    const ids = [...new Set([context.actorId, initial.userId])].sort()
    await tx.execute(sql`SELECT ${users.id} FROM ${users} WHERE ${inArray(users.id, ids)} ORDER BY ${users.id} FOR UPDATE`)
    await tx.execute(sql`SELECT ${tenants.id} FROM ${tenants} WHERE ${tenants.id} = ${context.tenantId} FOR SHARE`)
    await tx.execute(sql`SELECT ${userTenantRoles.id} FROM ${userTenantRoles}
      WHERE ${and(eq(userTenantRoles.tenantId, context.tenantId), inArray(userTenantRoles.userId, ids))}
      ORDER BY ${userTenantRoles.id} FOR UPDATE`)

    const actor = await tx.query.users.findFirst({ where: eq(users.id, context.actorId) })
    const league = await tx.query.tenants.findFirst({ where: eq(tenants.id, context.tenantId) })
    const actorMember = await tx.query.userTenantRoles.findFirst({ where: and(
      eq(userTenantRoles.userId, context.actorId), eq(userTenantRoles.tenantId, context.tenantId),
    ) })
    if (!actor || actor.id !== context.actorId || actor.isActive !== true
      || !league || league.id !== context.tenantId || league.isActive !== true
      || !actorMember || actorMember.userId !== context.actorId || actorMember.tenantId !== context.tenantId
      || actorMember.status !== "active" || actorMember.role !== "league_owner") {
      throw new Error("Forbidden: your member-management access changed")
    }
    const target = await tx.query.userTenantRoles.findFirst({ where: key })
    const account = await tx.query.users.findFirst({ where: eq(users.id, initial.userId) })
    if (!target || target.id !== parsed.membershipId || target.tenantId !== context.tenantId
      || target.userId !== initial.userId || !account || account.id !== target.userId) {
      throw new Error("Member not found in this league")
    }
    if (target.userId === context.actorId || target.userId === league.ownerId
      || target.role === "league_owner" || target.role === "super_admin" || account.role === "super_admin") {
      throw new Error("Owner, platform and self access cannot be removed here")
    }
    if (target.version !== parsed.expectedVersion) throw new Error("Member changed. Reload before saving.")
    // Keep these reads non-locking: assignment/scoring lock match -> users,
    // whereas removal already holds users. Locking a match here would invert
    // that order. READ COMMITTED ensures we see assignments committed by the
    // transaction whose user locks we waited for (see assignScorer).
    const managedTeam = await tx.query.teams.findFirst({ where: and(
      eq(teams.tenantId, context.tenantId), eq(teams.managerId, target.userId),
    ) })
    if (managedTeam) throw new Error("This member manages a team in this league. Unassign the team first.")
    const assignedMatch = await tx.query.matches.findFirst({ where: and(
      eq(matches.tenantId, context.tenantId), or(eq(matches.scorerId, target.userId), eq(matches.backupScorerId, target.userId)),
    ) })
    if (assignedMatch) throw new Error("This member is an assigned scorer. Unassign their matches first.")
    const [deleted] = await tx.delete(userTenantRoles)
      .where(and(key, eq(userTenantRoles.version, parsed.expectedVersion)))
      .returning({ membershipId: userTenantRoles.id, role: userTenantRoles.role,
        status: userTenantRoles.status, version: userTenantRoles.version })
    if (!deleted) throw new Error("Member changed. Reload before saving.")
    await tx.insert(auditLogs).values({
      requestId: randomUUID(), tenantId: context.tenantId, actorId: context.actorId,
      actorRole: actorMember.role, method: "MEMBERSHIP_REMOVE", path: "/dashboard/settings/members", statusCode: "200",
      payload: { membershipId: target.id, targetUserId: target.userId,
        before: { role: target.role, status: target.status, version: target.version }, after: null },
    })
  }, { isolationLevel: "read committed" })
  revalidatePath("/dashboard", "layout")
  return { success: true as const, membershipId: parsed.membershipId }
}
