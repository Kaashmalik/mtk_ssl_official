import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

/**
 * FAN-02 read-loop wiring guard. The notification read loop had one half
 * (bell "mark all") and a dead per-item writer (markNotificationRead with no
 * consumer). The inbox closes it honestly: per-item marking is member-gated
 * through the action tier, only UNREAD items offer the control, a failure
 * leaves the local state untouched, and the page hands the client only
 * serializable ISO timestamps. The bell's "mark all" path stays intact.
 */

const WEB_SRC = join(dirname(fileURLToPath(import.meta.url)), "..")

function source(rel: string) {
  return readFileSync(join(WEB_SRC, rel), "utf8")
}

describe("FAN-02 notification read-loop wiring", () => {
  it("offers per-item marking only for unread items, through the member-gated action", () => {
    const inbox = source("components/layout/notifications-inbox.tsx")
    expect(inbox).toContain('"use client"')
    expect(inbox).toContain("markNotificationRead")
    // The control is rendered inside the `!item.readAt` branch - read items
    // have no control and re-marking is impossible from the UI.
    expect(inbox).toMatch(/\{!item\.readAt && \(\s*<Button/)
    // Failure keeps the state untouched: setItems runs ONLY after success.
    const successAt = inbox.indexOf("if (!result.success)")
    const setItemsAt = inbox.indexOf("setItems(prev =>")
    expect(successAt).toBeGreaterThan(-1)
    expect(setItemsAt).toBeGreaterThan(successAt)
  })

  it("announces the honest unread count and never fakes read state", () => {
    const inbox = source("components/layout/notifications-inbox.tsx")
    expect(inbox).toContain('aria-live="polite"')
    expect(inbox).toContain("All caught up")
    // Read state comes from the server's readAt, or the action's success -
    // never from a click that was not confirmed.
    expect(inbox).toContain("readAt: new Date().toISOString()")
  })

  it("hands the inbox only serializable items from the page", () => {
    const page = source("app/dashboard/notifications/page.tsx")
    expect(page).toContain("<NotificationsInbox")
    // Dates cross the server/client boundary as ISO strings, not Date objects.
    expect(page).toContain("readAt ? n.readAt.toISOString() : null")
    expect(page).toContain("createdAt ? n.createdAt.toISOString() : null")
  })

  it("keeps the bell's mark-all path working alongside per-item marking", () => {
    const bell = source("components/layout/notification-bell.tsx")
    expect(bell).toContain("markAllNotificationsRead")
    const actionTier = source("app/actions/notifications.ts")
    expect(actionTier).toContain("markNotificationRead")
    expect(actionTier).toContain("markAllNotificationsRead")
  })
})
