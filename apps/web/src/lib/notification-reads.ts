import { auth } from "@clerk/nextjs/server"
import { db, users, userTenantRoles, tenants, notifications, notificationPreferences, membershipGrantsAccess } from "@mtk/database"
import { and, desc, eq, isNull, or } from "drizzle-orm"
import { z } from "zod"
import { resolveActiveTenantId } from "./rbac-server"
import type { UserRole } from "./rbac"

export type NotificationMemberContext = { tenantId: string; actorId: string; clerkId: string; role: UserRole }

/**
 * Personal notifications need a verified active league membership, not a broad
 * management permission: a fan, player or commentator with no match-scoped
 * capability must still see their own bell. `super_admin` is deliberately
 * rejected here (it is a platform identity, not league membership), and every
 * query below is scoped to a tenant resolved from a real junction row — never a
 * global role, the mutable `users.tenantIds` array or a client-supplied tenant.
 */
export async function requireNotificationMemberContext(): Promise<NotificationMemberContext> {
  const { userId: clerkId } = await auth()
  if (!clerkId) throw new Error("Unauthorized")
  const tenantId = await resolveActiveTenantId()
  if (!tenantId) throw new Error("Tenant not found")
  const actor = await db.query.users.findFirst({ where: eq(users.clerkId, clerkId) })
  if (!actor || actor.clerkId !== clerkId || actor.isActive !== true) throw new Error("Forbidden: account unavailable")
  const membership = await db.query.userTenantRoles.findFirst({ where: and(
    eq(userTenantRoles.userId, actor.id), eq(userTenantRoles.tenantId, tenantId)) })
  const league = await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) })
  if (!membership || membership.userId !== actor.id || membership.tenantId !== tenantId
    || !membershipGrantsAccess(membership) || membership.role === "super_admin"
    || !league || league.id !== tenantId || league.isActive !== true) {
    throw new Error("Forbidden: league access unavailable")
  }
  return { tenantId, actorId: actor.id, clerkId, role: membership.role as UserRole }
}

/**
 * A non-throwing access decision for pages that should bounce a caller who is
 * simply not an active member of any league, while still surfacing a genuine
 * tenant/membership/database failure to the route error boundary. Returns `null`
 * only for a confirmed non-member.
 */
export async function resolveNotificationMemberContext(): Promise<NotificationMemberContext | null> {
  const { userId: clerkId } = await auth()
  if (!clerkId) return null
  const tenantId = await resolveActiveTenantId()
  if (!tenantId) return null
  const actor = await db.query.users.findFirst({ where: eq(users.clerkId, clerkId) })
  if (!actor || actor.clerkId !== clerkId || actor.isActive !== true) return null
  const membership = await db.query.userTenantRoles.findFirst({ where: and(
    eq(userTenantRoles.userId, actor.id), eq(userTenantRoles.tenantId, tenantId)) })
  if (!membership || membership.userId !== actor.id || membership.tenantId !== tenantId
    || !membershipGrantsAccess(membership) || membership.role === "super_admin") return null
  const league = await db.query.tenants.findFirst({ where: eq(tenants.id, tenantId) })
  if (!league || league.id !== tenantId || league.isActive !== true) return null
  return { tenantId, actorId: actor.id, clerkId, role: membership.role as UserRole }
}

export const notificationListLimit = z.number().int().min(1).max(100)

/**
 * Rows addressed directly to the member plus league-wide in-app rows for the
 * exact active league. Both branches carry the resolved tenant predicate, so a
 * notification belonging to another league can never be read or mutated.
 */
export function myNotificationFilter(actorId: string, tenantId: string) {
  return or(
    and(eq(notifications.userId, actorId), eq(notifications.tenantId, tenantId)),
    and(isNull(notifications.userId), eq(notifications.tenantId, tenantId)),
  )
}

/** Bounded newest-first list of the member's notifications in the active league. */
export async function readMyNotifications(context: NotificationMemberContext, limit = 20) {
  return db.select({
    id: notifications.id, title: notifications.title, body: notifications.body,
    type: notifications.type, readAt: notifications.readAt, createdAt: notifications.createdAt,
  })
    .from(notifications)
    .where(myNotificationFilter(context.actorId, context.tenantId))
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(notificationListLimit.parse(limit))
}

/** Unread count in the active league. */
export async function readUnreadNotificationCount(context: NotificationMemberContext) {
  const rows = await db.select({ id: notifications.id }).from(notifications)
    .where(and(myNotificationFilter(context.actorId, context.tenantId), isNull(notifications.readAt)))
  return rows.length
}

/**
 * Mark one notification read. The id is a validated UUID and the update predicate
 * re-asserts the same tenant/ownership filter, so a crafted id cannot touch a row
 * outside the active league or belonging to another member.
 */
export async function markNotificationReadById(context: NotificationMemberContext, id: string) {
  z.string().uuid().parse(id)
  await db.update(notifications)
    .set({ readAt: new Date(), status: "read" })
    .where(and(eq(notifications.id, id), myNotificationFilter(context.actorId, context.tenantId)))
}

/** Mark every unread notification in the active league read. */
export async function markAllNotificationsReadFor(context: NotificationMemberContext) {
  await db.update(notifications)
    .set({ readAt: new Date(), status: "read" })
    .where(and(myNotificationFilter(context.actorId, context.tenantId), isNull(notifications.readAt)))
}

export type MyNotificationPreferences = {
  inAppEnabled: boolean
  quietStartMinute: number | null
  quietEndMinute: number | null
  timeZone: string | null
}

/**
 * The member's notification preferences in the active league, or `null` when
 * none were ever saved (policy then applies the historical default). The
 * lookup is pinned to the resolved membership pair, never a client tenant.
 */
export async function readMyNotificationPreferences(
  context: NotificationMemberContext,
): Promise<MyNotificationPreferences | null> {
  const [row] = await db
    .select({
      inAppEnabled: notificationPreferences.inAppEnabled,
      quietStartMinute: notificationPreferences.quietStartMinute,
      quietEndMinute: notificationPreferences.quietEndMinute,
      timeZone: notificationPreferences.timeZone,
    })
    .from(notificationPreferences)
    .where(and(
      eq(notificationPreferences.tenantId, context.tenantId),
      eq(notificationPreferences.userId, context.actorId),
    ))
    .limit(1)
  return row ?? null
}
