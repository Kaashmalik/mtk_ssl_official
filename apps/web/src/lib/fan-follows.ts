import { auth } from "@clerk/nextjs/server"
import { db, users, userTenantRoles, tenants, teams, players, tournaments, fanFollows, membershipGrantsAccess } from "@mtk/database"
import { and, eq, asc, count } from "drizzle-orm"
import { z } from "zod"
import { resolveActiveTenantId, requirePermissionServer } from "./rbac-server"
import { hasPermission, type Permission, type UserRole } from "./rbac"

export type FanFollowType = "team" | "player" | "tournament"
export type FanContext = { tenantId: string; actorId: string; clerkId: string; role: UserRole }

export const fanFollowSchema = z.object({
  followableType: z.enum(["team", "player", "tournament"]),
  followableId: z.string().uuid(),
}).strict()

/**
 * Active membership in the exact active league with the follow permission.
 * Follows never use a global role, a client-supplied tenant or a tenant array.
 */
export async function requireFanContext(permission: Permission = "fan:follow"): Promise<FanContext> {
  const { userId: clerkId } = await auth()
  if (!clerkId) throw new Error("Unauthorized — sign in to follow")
  const tenantId = await resolveActiveTenantId()
  if (!tenantId) throw new Error("Tenant not found")
  await requirePermissionServer(permission, tenantId)
  const actor = await db.query.users.findFirst({ where: eq(users.clerkId, clerkId) })
  if (!actor || actor.clerkId !== clerkId || actor.isActive !== true) throw new Error("Forbidden: follow account unavailable")
  const membership = await db.query.userTenantRoles.findFirst({ where: and(
    eq(userTenantRoles.userId, actor.id), eq(userTenantRoles.tenantId, tenantId)) })
  const league = await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) })
  if (!membership || membership.userId !== actor.id || membership.tenantId !== tenantId
    || !membershipGrantsAccess(membership) || membership.role === "super_admin" || !hasPermission(membership.role, permission)
    || !league || league.id !== tenantId || league.isActive !== true) {
    throw new Error("Forbidden: follow access unavailable")
  }
  return { tenantId, actorId: actor.id, clerkId, role: membership.role }
}

function followableTable(type: FanFollowType) {
  return type === "team" ? teams : type === "player" ? players : tournaments
}

/** The target must exist in the exact active league; the client tenant is never trusted. */
export async function assertFollowableInLeague(tenantId: string, type: FanFollowType, id: string) {
  const table = followableTable(type)
  const [row] = await db.select({ id: table.id }).from(table)
    .where(and(eq(table.id, id), eq(table.tenantId, tenantId))).limit(1)
  if (!row || row.id !== id) throw new Error("Follow target is unavailable in this league")
}

/** Follow a same-league entity as the signed-in account. Idempotent under the unique index. */
export async function followFanEntity(tenantId: string, type: FanFollowType, id: string) {
  const input = fanFollowSchema.parse({ followableType: type, followableId: id })
  if (!z.string().uuid().safeParse(tenantId).success) throw new Error("Invalid tenant")
  const context = await requireFanContext("fan:follow")
  if (tenantId !== context.tenantId) throw new Error("Invalid tenant")
  await assertFollowableInLeague(context.tenantId, input.followableType, input.followableId)
  const existing = await db.select({ id: fanFollows.id }).from(fanFollows)
    .where(and(eq(fanFollows.tenantId, context.tenantId), eq(fanFollows.userId, context.actorId),
      eq(fanFollows.followableType, input.followableType), eq(fanFollows.followableId, input.followableId))).limit(1)
  if (existing.length > 0) return { action: "already_following" as const }
  // The (userId, type, id) unique index makes a duplicate insert a no-op under a race.
  await db.insert(fanFollows).values({ tenantId: context.tenantId, userId: context.actorId,
    followableType: input.followableType, followableId: input.followableId }).onConflictDoNothing()
  return { action: "followed" as const }
}

/** Remove the signed-in account's follow inside the exact active league. */
export async function unfollowFanEntity(type: FanFollowType, id: string) {
  const input = fanFollowSchema.parse({ followableType: type, followableId: id })
  const context = await requireFanContext("fan:follow")
  await db.delete(fanFollows).where(and(eq(fanFollows.tenantId, context.tenantId),
    eq(fanFollows.userId, context.actorId), eq(fanFollows.followableType, input.followableType),
    eq(fanFollows.followableId, input.followableId)))
  return { action: "unfollowed" as const }
}

/** Follower count is scoped to the exact active league; invalid ids read as zero. */
export async function getFanFollowerCount(type: FanFollowType, id: string): Promise<number> {
  const input = fanFollowSchema.safeParse({ followableType: type, followableId: id })
  if (!input.success) return 0
  const tenantId = await resolveActiveTenantId()
  if (!tenantId) return 0
  const [row] = await db.select({ total: count() }).from(fanFollows)
    .where(and(eq(fanFollows.tenantId, tenantId), eq(fanFollows.followableType, input.data.followableType),
      eq(fanFollows.followableId, input.data.followableId)))
  return Number(row.total)
}

/** Current-user follow state in the exact active league, matched on the account UUID. */
export async function isFanFollowing(type: FanFollowType, id: string): Promise<boolean> {
  const input = fanFollowSchema.safeParse({ followableType: type, followableId: id })
  if (!input.success) return false
  const { userId: clerkId } = await auth()
  if (!clerkId) return false
  const tenantId = await resolveActiveTenantId()
  if (!tenantId) return false
  const actor = await db.query.users.findFirst({ where: eq(users.clerkId, clerkId) })
  if (!actor || actor.clerkId !== clerkId || actor.isActive !== true) return false
  const [row] = await db.select({ total: count() }).from(fanFollows)
    .where(and(eq(fanFollows.tenantId, tenantId), eq(fanFollows.userId, actor.id),
      eq(fanFollows.followableType, input.data.followableType),
      eq(fanFollows.followableId, input.data.followableId)))
  return Number(row.total) > 0
}

/** The signed-in account's follows in the exact active league (server-resolved tenant). */
export async function getMyFollowingFanEntities() {
  const { userId: clerkId } = await auth()
  if (!clerkId) return []
  const tenantId = await resolveActiveTenantId()
  if (!tenantId) return []
  const actor = await db.query.users.findFirst({ where: eq(users.clerkId, clerkId) })
  if (!actor || actor.clerkId !== clerkId || actor.isActive !== true) return []
  return db.select().from(fanFollows)
    .where(and(eq(fanFollows.tenantId, tenantId), eq(fanFollows.userId, actor.id)))
    .orderBy(asc(fanFollows.createdAt))
}
