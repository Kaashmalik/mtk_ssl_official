import React from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import NotificationsPage from "@/app/dashboard/notifications/page"

const mocks = vi.hoisted(() => ({ access: vi.fn(), list: vi.fn(), preferences: vi.fn() }))
const redirects = vi.hoisted(() => ({ calls: [] as string[] }))

vi.mock("next/navigation", () => ({
  redirect: (href: string) => { redirects.calls.push(href); throw new Error(`redirect:${href}`) },
}))
vi.mock("next/cache", () => ({ unstable_noStore: () => {} }))
vi.mock("@/lib/notification-reads", () => ({
  resolveNotificationMemberContext: mocks.access,
  readMyNotifications: mocks.list,
  readMyNotificationPreferences: mocks.preferences,
}))

const TENANT = "00000000-0000-4000-8000-000000000001"
const context = { tenantId: TENANT, actorId: "actor", clerkId: "clerk", role: "player" }
const row = { id: "n1", title: "Match starting", body: "Falcons vs Lions", type: "match",
  readAt: null, createdAt: new Date("2026-10-15T00:00:00.000Z") }

/** Collects rendered server-side string children from the page tree. */
function collectTitles(node: unknown, out: string[] = []): string[] {
  if (!React.isValidElement(node)) return out
  const props = node.props as { children?: React.ReactNode }
  if (typeof props.children === "string") out.push(props.children)
  React.Children.forEach(props.children, (child) => collectTitles(child, out))
  return out
}

/** The bare-RSC boundary: the inbox is a client element - its props carry
 * the items. A stubbed/unevaluated client component never renders its
 * children into the extractable tree, so tests assert the props. */
function findInboxItems(node: unknown): Array<Record<string, unknown>> | null {
  if (!React.isValidElement(node)) return null
  const element = node as { type: { name?: string }; props: { children?: React.ReactNode; items?: unknown } }
  if (element.type?.name === "NotificationsInbox") {
    return element.props.items as Array<Record<string, unknown>>
  }
  let found: Array<Record<string, unknown>> | null = null
  React.Children.forEach(element.props.children, (child) => {
    if (!found) found = findInboxItems(child)
  })
  return found
}

beforeEach(() => {
  vi.resetAllMocks()
  redirects.calls.length = 0
  mocks.access.mockResolvedValue(context)
  mocks.list.mockResolvedValue([row])
  mocks.preferences.mockResolvedValue(null)
})

describe("Notifications page scopes to the exact active league", () => {
  it("reads the member's bounded notifications for the resolved league", async () => {
    const tree = await NotificationsPage()
    expect(mocks.access).toHaveBeenCalledTimes(1)
    expect(mocks.list).toHaveBeenCalledWith(context, 50)
    // FAN-02: the preferences card reads the same resolved membership context.
    expect(mocks.preferences).toHaveBeenCalledWith(context)
    expect(collectTitles(tree)).toContain("Notification preferences")
    // The titles crossed into the client inbox as serializable ISO items -
    // assert the element's props (a client component's children are not part
    // of the server render tree).
    const items = findInboxItems(tree)
    expect(items).not.toBeNull()
    expect(items![0]).toMatchObject({
      id: "n1",
      title: "Match starting",
      body: "Falcons vs Lions",
      readAt: null,
      createdAt: "2026-10-15T00:00:00.000Z",
    })
  })

  it("sends a confirmed non-member to the dashboard without reading", async () => {
    mocks.access.mockResolvedValue(null)
    await expect(NotificationsPage()).rejects.toThrow("redirect:/dashboard")
    expect(mocks.list).not.toHaveBeenCalled()
  })

  it.each(["Database unavailable", "Tenant lookup failed"])(
    "propagates %s instead of treating it like a non-member visit", async (message) => {
      mocks.access.mockRejectedValue(new Error(message))
      await expect(NotificationsPage()).rejects.toThrow(message)
      expect(redirects.calls).not.toContain("/dashboard")
      expect(mocks.list).not.toHaveBeenCalled()
    })

  it("propagates a read failure instead of rendering an empty page", async () => {
    mocks.list.mockRejectedValue(new Error("Database unavailable"))
    await expect(NotificationsPage()).rejects.toThrow("Database unavailable")
    expect(redirects.calls).toEqual([])
  })
})
