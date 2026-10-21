"use client"

import { useState } from "react"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@mtk/ui/components/ui/card"
import { Badge } from "@mtk/ui/components/ui/badge"
import { Button } from "@mtk/ui/components/ui/button"
import { toast } from "sonner"
import { markNotificationRead } from "@/app/actions/notifications"

export type InboxItem = {
  id: string
  title: string
  type: string
  body: string | null
  readAt: string | null
  createdAt: string | null
  /**
   * ENH-06-03: the match this notice is about (server-validated UUID), when
   * the writer attached one. The link names a match - it grants nothing; the
   * match page applies its own publication/access rules.
   */
  matchId?: string | null
}

/**
 * The member's notification inbox with per-item read marking (the missing
 * half of the read loop - the bell only ever offered "mark all"). Marking is
 * idempotent server-side; a success closes the New badge and dims the card
 * locally, a failure leaves the state untouched and says so. Marking an
 * already-read item is an honest no-op button - the control simply is not
 * rendered for read items.
 */
export function NotificationsInbox({ items: initialItems }: { items: InboxItem[] }) {
  const [items, setItems] = useState(initialItems)
  const [pendingId, setPendingId] = useState<string | null>(null)

  const unreadCount = items.filter(item => !item.readAt).length

  async function markRead(id: string) {
    setPendingId(id)
    try {
      const result = await markNotificationRead(id)
      if (!result.success) {
        toast.error("Could not mark this notification read")
      } else {
        setItems(prev => prev.map(item =>
          item.id === id && !item.readAt
            ? { ...item, readAt: new Date().toISOString() }
            : item,
        ))
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not mark this notification read")
    } finally {
      setPendingId(null)
    }
  }

  if (items.length === 0) {
    return <p className="text-muted-foreground">No notifications yet.</p>
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {unreadCount === 0
          ? "All caught up - no unread notifications."
          : `${unreadCount} unread notification${unreadCount === 1 ? "" : "s"}.`}
      </p>
      {items.map((item) => (
        <Card key={item.id} className={item.readAt ? "opacity-70" : ""}>
          <CardHeader className="py-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">{item.title}</CardTitle>
              <div className="flex items-center gap-2">
                {!item.readAt && <Badge className="bg-blue-600 text-white">New</Badge>}
                <Badge variant="outline">{item.type}</Badge>
                {!item.readAt && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pendingId === item.id}
                    onClick={() => markRead(item.id)}
                    aria-label={`Mark "${item.title}" read`}
                  >
                    Mark read
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="py-3 pt-0">
            {item.body && <p className="text-sm text-muted-foreground">{item.body}</p>}
            {item.matchId && (
              <Link
                href={`/matches/${item.matchId}`}
                className="mt-2 inline-block text-sm font-medium underline underline-offset-4"
              >
                View match
              </Link>
            )}
            {item.createdAt && (
              <p className="text-xs text-muted-foreground mt-1">
                {new Date(item.createdAt).toLocaleString()}
              </p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
