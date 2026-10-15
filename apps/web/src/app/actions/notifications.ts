"use server"

import {
  requireNotificationMemberContext, readMyNotifications, readUnreadNotificationCount,
  markNotificationReadById, markAllNotificationsReadFor, notificationListLimit,
} from "@/lib/notification-reads"

/**
 * Notifications are inherently personal — there is no league-wide "read"
 * action. They are guarded by a verified active-league membership rather than a
 * management permission, because roles like fan, player or commentator have no
 * match-scoped capability but must still see their own bell.
 *
 * The two read helpers resolve the exact active league from a real junction
 * membership row (never a global role, the mutable `users.tenantIds` array or a
 * client-supplied tenant). They return an empty result when the caller simply is
 * not a member — so the bell still renders during an unauthenticated SSR pass —
 * while a genuine tenant/membership/database failure is left to propagate.
 */

async function readOrEmpty<T>(read: (context: Awaited<ReturnType<typeof requireNotificationMemberContext>>) => Promise<T>, empty: T): Promise<T> {
  try {
    const context = await requireNotificationMemberContext()
    return await read(context)
  } catch (error) {
    const message = error instanceof Error ? error.message : ""
    // Absence of a session or an active league is "not entitled", not a failure.
    if (message === "Unauthorized" || message === "Tenant not found"
      || message.startsWith("Forbidden")) return empty
    throw error
  }
}

export async function getMyNotifications(limit = 20) {
  return readOrEmpty(
    (context) => readMyNotifications(context, notificationListLimit.parse(limit)),
    [],
  )
}

export async function getUnreadCount() {
  return readOrEmpty((context) => readUnreadNotificationCount(context), 0)
}

export async function markNotificationRead(id: string) {
  const context = await requireNotificationMemberContext()
  await markNotificationReadById(context, id)
  return { success: true }
}

export async function markAllNotificationsRead() {
  const context = await requireNotificationMemberContext()
  await markAllNotificationsReadFor(context)
  return { success: true }
}
