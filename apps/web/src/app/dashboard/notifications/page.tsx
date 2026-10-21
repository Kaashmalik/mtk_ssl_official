import React from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@mtk/ui/components/ui/card"
import { unstable_noStore as noStore } from "next/cache"
import { redirect } from "next/navigation"
import { resolveNotificationMemberContext, readMyNotifications, readMyNotificationPreferences } from "@/lib/notification-reads"
import { NotificationPreferencesForm } from "@/components/layout/notification-preferences-form"
import { NotificationsInbox, type InboxItem } from "@/components/layout/notifications-inbox"

export default async function NotificationsPage() {
  noStore()

  // Only active league members reach their bell; a genuine non-member is bounced
  // to the dashboard, while a tenant/membership/read failure propagates to the
  // route error boundary instead of a benign-looking empty page.
  const context = await resolveNotificationMemberContext()
  if (!context) redirect("/dashboard")

  const [items, preferences] = await Promise.all([
    readMyNotifications(context, 50),
    readMyNotificationPreferences(context),
  ])

  // The zone input is prefilled from the server's own locale zone only as a
  // convenience; the member can name any IANA zone and the policy re-validates.
  const defaultTimeZone = new Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"

  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-2xl font-bold">Notifications</h1>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Notification preferences</CardTitle>
        </CardHeader>
        <CardContent>
          <NotificationPreferencesForm initial={preferences} defaultTimeZone={defaultTimeZone} />
        </CardContent>
      </Card>
      {/* Per-item read marking (the read loop's missing half): the bell only
          ever offered "mark all"; here the member closes one notification at
          a time through the action tier's member-gated writer. */}
      <NotificationsInbox
        items={items.map((n): InboxItem => ({
          id: n.id,
          title: n.title,
          type: n.type,
          body: n.body ?? null,
          readAt: n.readAt ? n.readAt.toISOString() : null,
          createdAt: n.createdAt ? n.createdAt.toISOString() : null,
          // ENH-06-03: the server-validated match id (null when the notice is
          // not about a match).
          matchId: n.matchId ?? null,
        }))}
      />
    </div>
  )
}
