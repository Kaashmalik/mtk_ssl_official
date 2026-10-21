import { auth } from "@clerk/nextjs/server"
import {
  db, users, userTenantRoles, tenants, notifications, notificationReads,
  notificationPreferences, membershipGrantsAccess,
} from "@mtk/database"
import { and, desc, eq, isNull, or, sql } from "drizzle-orm"
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
 * ENH-06-03: how many league-wide notifications one "mark all read" may
 * acknowledge per member. The list itself is bounded at 100 rows; the write is
 * bounded too, so a league with a huge broadcast backlog cannot turn one click
 * into an unbounded insert.
 */
export const BROADCAST_READ_MARK_LIMIT = 200

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

/**
 * ENH-06-03: the member's read state for one notification.
 *
 * Personal rows carry their own `read_at`. A league-wide row is SHARED, so the
 * marker lives in `notification_reads` (one row per member) and the effective
 * state is the member's marker when it exists, otherwise the row's own
 * `read_at`.
 */
function effectiveReadAt() {
  return sql<Date | null>`coalesce(${notificationReads.readAt}, ${notifications.readAt})`
}

/** The member-scoped join that resolves a league-wide row's own read marker. */
function memberReadJoin(actorId: string) {
  return and(
    eq(notificationReads.notificationId, notifications.id),
    eq(notificationReads.userId, actorId),
  )
}

/**
 * The match a notification points at, when the writer attached one. The id is
 * validated as a UUID: a crafted `data.matchId` must never become a link.
 */
function matchIdFromData(data: unknown): string | null {
  const raw = (data as { matchId?: unknown } | null | undefined)?.matchId
  if (typeof raw !== "string") return null
  const parsed = z.string().uuid().safeParse(raw)
  return parsed.success ? parsed.data : null
}

/** Bounded newest-first list of the member's notifications in the active league. */
export async function readMyNotifications(context: NotificationMemberContext, limit = 20) {
  const rows = await db.select({
    id: notifications.id, title: notifications.title, body: notifications.body,
    type: notifications.type, readAt: effectiveReadAt(), createdAt: notifications.createdAt,
    data: notifications.data,
  })
    .from(notifications)
    .leftJoin(notificationReads, memberReadJoin(context.actorId))
    .where(myNotificationFilter(context.actorId, context.tenantId))
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(notificationListLimit.parse(limit))
  return rows.map((row) => ({ ...row, matchId: matchIdFromData(row.data) }))
}

/** Unread count in the active league (member-scoped for league-wide rows). */
export async function readUnreadNotificationCount(context: NotificationMemberContext) {
  const rows = await db.select({ id: notifications.id })
    .from(notifications)
    .leftJoin(notificationReads, memberReadJoin(context.actorId))
    .where(and(
      myNotificationFilter(context.actorId, context.tenantId),
      isNull(notifications.readAt),
      isNull(notificationReads.readAt),
    ))
  return rows.length
}

/**
 * Mark one notification read. The id is a validated UUID and the update predicate
 * re-asserts the same tenant/ownership filter, so a crafted id cannot touch a row
 * outside the active league or belonging to another member.
 *
 * ENH-06-03: a LEAGUE-WIDE row is shared by every member, so marking it read
 * writes this member's own marker in `notification_reads` and never touches the
 * shared row — one member reading a broadcast must not silence it for the
 * others. A personal row keeps its own `read_at`.
 */
export async function markNotificationReadById(context: NotificationMemberContext, id: string) {
  z.string().uuid().parse(id)
  const [row] = await db
    .select({ id: notifications.id, userId: notifications.userId })
    .from(notifications)
    .where(and(eq(notifications.id, id), myNotificationFilter(context.actorId, context.tenantId)))
    .limit(1)
  if (!row) return

  const now = new Date()
  if (row.userId === null) {
    await db.insert(notificationReads)
      .values({ notificationId: row.id, userId: context.actorId, readAt: now })
      .onConflictDoUpdate({
        target: [notificationReads.notificationId, notificationReads.userId],
        set: { readAt: now },
      })
    return
  }

  await db.update(notifications)
    .set({ readAt: now, status: "read" })
    .where(and(eq(notifications.id, id), myNotificationFilter(context.actorId, context.tenantId)))
}

/**
 * Mark every unread notification in the active league read - the member's own
 * personal rows plus a per-member marker for each league-wide row (bounded).
 */
export async function markAllNotificationsReadFor(context: NotificationMemberContext) {
  const now = new Date()
  await db.update(notifications)
    .set({ readAt: now, status: "read" })
    .where(and(
      myNotificationFilter(context.actorId, context.tenantId),
      eq(notifications.userId, context.actorId),
      isNull(notifications.readAt),
    ))

  const broadcasts = await db
    .select({ id: notifications.id })
    .from(notifications)
    .leftJoin(notificationReads, memberReadJoin(context.actorId))
    .where(and(
      myNotificationFilter(context.actorId, context.tenantId),
      isNull(notifications.userId),
      isNull(notifications.readAt),
      isNull(notificationReads.readAt),
    ))
    .limit(BROADCAST_READ_MARK_LIMIT)
  if (broadcasts.length === 0) return

  await db.insert(notificationReads)
    .values(broadcasts.map((row) => ({ notificationId: row.id, userId: context.actorId, readAt: now })))
    .onConflictDoNothing()
}

export type MyNotificationPreferences = {
  inAppEnabled: boolean
  /**
   * ENH-06-03: the per-league channel consents are part of the member's
   * settings. They MUST round-trip: a reload that dropped them rendered the
   * channel switches OFF, and the next save then revoked the consent the
   * member had already given.
   */
  emailEnabled: boolean
  pushEnabled: boolean
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
      emailEnabled: notificationPreferences.emailEnabled,
      pushEnabled: notificationPreferences.pushEnabled,
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
