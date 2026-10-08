"use client"

import { useEffect, useState, useCallback } from "react"
import Link from "next/link"
import { Button } from "@mtk/ui/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@mtk/ui/components/ui/dropdown-menu"
import { Bell } from "lucide-react"
import { getMyNotifications, getUnreadCount, markAllNotificationsRead } from "@/app/actions/notifications"
import { useNotificationSocket } from "@/hooks/use-notification-socket"

interface NotificationItem {
  id: string
  title: string
  body: string | null
  readAt: Date | string | null
  createdAt: Date | string | null
}

export function NotificationBell() {
  const [count, setCount] = useState(0)
  const [items, setItems] = useState<NotificationItem[]>([])
  const [open, setOpen] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const [c, list] = await Promise.all([getUnreadCount(), getMyNotifications(10)])
      setCount(c)
      setItems(list as unknown as NotificationItem[])
    } catch {
      /* unauthenticated */
    }
  }, [])

  useEffect(() => {
    refresh()
    // Fallback polling (30s) in case the WS drops or is disabled
    const t = setInterval(refresh, 30000)
    return () => clearInterval(t)
  }, [refresh])

  // Real-time update via WebSocket
  useNotificationSocket({
    onNotification: () => refresh(),
  })

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Notifications" className="relative">
          <Bell className="h-4 w-4" />
          {count > 0 && (
            <span className="absolute -top-0.5 -right-0.5 h-4 min-w-4 rounded-full bg-live text-[10px] font-bold text-white flex items-center justify-center px-0.5">
              {count > 9 ? "9+" : count}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-80 p-0" align="end">
        <div className="flex items-center justify-between px-4 py-2 border-b">
          <p className="font-semibold text-sm">Notifications</p>
          {count > 0 && (
            <button
              className="text-xs text-primary underline"
              onClick={async () => { await markAllNotificationsRead(); await refresh() }}
            >
              Mark all read
            </button>
          )}
        </div>
        <div className="max-h-80 overflow-y-auto">
          {items.length === 0 && <p className="text-sm text-muted-foreground text-center py-6">No notifications yet.</p>}
          {items.map((n) => (
            <div key={n.id} className={`px-4 py-2 border-b last:border-0 text-sm ${n.readAt ? "opacity-60" : ""}`}>
              <p className="font-medium">{n.title}</p>
              {n.body && <p className="text-xs text-muted-foreground">{n.body}</p>}
              {n.createdAt && <p className="text-[10px] text-muted-foreground mt-0.5">{new Date(n.createdAt).toLocaleString()}</p>}
            </div>
          ))}
        </div>
        <Link href="/dashboard/notifications" className="block text-center text-xs text-primary py-2 border-t" onClick={() => setOpen(false)}>
          View all
        </Link>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
