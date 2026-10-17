import React from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@mtk/ui/components/ui/card"
import { Badge } from "@mtk/ui/components/ui/badge"
import { unstable_noStore as noStore } from "next/cache"
import { redirect } from "next/navigation"
import { resolveNotificationMemberContext, readMyNotifications, readMyNotificationPreferences } from "@/lib/notification-reads"
import { NotificationPreferencesForm } from "@/components/layout/notification-preferences-form"

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
      {items.length === 0 && <p className="text-muted-foreground">No notifications yet.</p>}
      {items.map((n) => (
        <Card key={n.id} className={n.readAt ? "opacity-70" : ""}>
          <CardHeader className="py-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">{n.title}</CardTitle>
              <div className="flex items-center gap-2">
                {!n.readAt && <Badge className="bg-blue-600 text-white">New</Badge>}
                <Badge variant="outline">{n.type}</Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent className="py-3 pt-0">
            {n.body && <p className="text-sm text-muted-foreground">{n.body}</p>}
            {n.createdAt && <p className="text-xs text-muted-foreground mt-1">{new Date(n.createdAt).toLocaleString()}</p>}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
