"use server"

import { auth } from "@clerk/nextjs/server"
import { db, notifications, users } from "@mtk/database"
import { and, desc, eq, isNull, or } from "drizzle-orm"
import { getMyTenant } from "@/app/actions/tenants"

/**
 * Notifications are inherently personal — there is no tenant-wide "read" action.
 * These actions are guarded by session presence plus an explicit active-tenant
 * check rather than an RBAC permission:
 *
 *   - `match:read` would wrongly exclude roles like commentator or viewer, who
 *     have no match-scoped permission but should still see their own bell.
 *   - Leaving them unguarded (the previous state) meant every query was scoped
 *     by `users.tenantIds` alone — a mutable legacy array with no verification
 *     that it reflects real tenant membership.
 *
 * `requireTenantContext` resolves the caller's active tenant via the RBAC
 * junction table and returns null otherwise, so each query below is scoped by a
 * tenant id that was actually confirmed, not one read off the user row.
 */

type CurrentUser = { id: string; tenantIds: string[] }

async function getCurrentUser(): Promise<CurrentUser | null> {
  const { userId } = await auth()
  if (!userId) return null
  const [u] = await db
    .select({ id: users.id, tenantIds: users.tenantIds })
    .from(users)
    .where(eq(users.clerkId, userId))
    .limit(1)
  return u ?? null
}

/**
 * Resolves the caller plus their active tenant, or null when they have neither.
 *
 * Null is treated as "not entitled" and yields empty results rather than a
 * throw, so the bell still renders during an unauthenticated SSR pass.
 */
async function requireTenantContext(): Promise<{
  user: CurrentUser
  tenantId: string
} | null> {
  const user = await getCurrentUser()
  if (!user) return null

  const tenant = await getMyTenant()
  if (!tenant) return null

  return { user, tenantId: tenant.id }
}

/**
 * Notifications visible to the current user:
 *   - rows addressed directly to them (user_id = me)
 *   - tenant-wide in_app rows for their active tenant (user_id IS NULL)
 */
function myNotificationFilter(user: CurrentUser, tenantId: string) {
  return or(
    eq(notifications.userId, user.id),
    and(isNull(notifications.userId), eq(notifications.tenantId, tenantId)),
  )
}

export async function getMyNotifications(limit = 20) {
  const ctx = await requireTenantContext()
  if (!ctx) return []
  return db
    .select()
    .from(notifications)
    .where(myNotificationFilter(ctx.user, ctx.tenantId))
    .orderBy(desc(notifications.createdAt))
    // Clamp: a non-finite, zero, or negative value from a client component
    // would otherwise produce an invalid or unbounded query.
    .limit(Number.isFinite(limit) ? Math.min(Math.max(Math.trunc(limit), 1), 100) : 20)
}

export async function getUnreadCount() {
  const ctx = await requireTenantContext()
  if (!ctx) return 0
  const rows = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      and(myNotificationFilter(ctx.user, ctx.tenantId), isNull(notifications.readAt)),
    )
  return rows.length
}

export async function markNotificationRead(id: string) {
  const ctx = await requireTenantContext()
  if (!ctx) return { success: false }
  // The `myNotificationFilter` predicate in the WHERE clause is what prevents a
  // caller from marking a notification belonging to another tenant as read.
  await db
    .update(notifications)
    .set({ readAt: new Date(), status: "read" })
    .where(and(eq(notifications.id, id), myNotificationFilter(ctx.user, ctx.tenantId)))
  return { success: true }
}

export async function markAllNotificationsRead() {
  const ctx = await requireTenantContext()
  if (!ctx) return { success: false }
  await db
    .update(notifications)
    .set({ readAt: new Date(), status: "read" })
    .where(
      and(myNotificationFilter(ctx.user, ctx.tenantId), isNull(notifications.readAt)),
    )
  return { success: true }
}
