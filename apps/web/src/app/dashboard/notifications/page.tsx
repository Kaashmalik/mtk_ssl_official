import { Card, CardContent, CardHeader, CardTitle } from "@mtk/ui/components/ui/card"
import { Badge } from "@mtk/ui/components/ui/badge"
import { unstable_noStore as noStore } from "next/cache"
import { getMyNotifications } from "@/app/actions/notifications"

export default async function NotificationsPage() {
  noStore()
  const items = await getMyNotifications(50)

  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-2xl font-bold">Notifications</h1>
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
