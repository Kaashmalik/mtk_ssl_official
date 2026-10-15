import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  requireContext: vi.fn(), readList: vi.fn(), readCount: vi.fn(),
  markOne: vi.fn(), markAll: vi.fn(), parseLimit: vi.fn(),
}))

vi.mock("@/lib/notification-reads", () => ({
  requireNotificationMemberContext: mocks.requireContext,
  readMyNotifications: mocks.readList,
  readUnreadNotificationCount: mocks.readCount,
  markNotificationReadById: mocks.markOne,
  markAllNotificationsReadFor: mocks.markAll,
  notificationListLimit: { parse: mocks.parseLimit },
}))

import {
  getMyNotifications, getUnreadCount, markNotificationRead, markAllNotificationsRead,
} from "@/app/actions/notifications"

const context = { tenantId: "t", actorId: "a", clerkId: "c", role: "player" as const }

beforeEach(() => {
  vi.resetAllMocks()
  mocks.requireContext.mockResolvedValue(context)
  mocks.readList.mockResolvedValue([{ id: "n1" }])
  mocks.readCount.mockResolvedValue(3)
  mocks.markOne.mockResolvedValue(undefined)
  mocks.markAll.mockResolvedValue(undefined)
  mocks.parseLimit.mockImplementation((value: number) => value)
})

describe("Notification actions keep the personal-read contract", () => {
  it("reads the list through the resolved member context with a parsed limit", async () => {
    expect(await getMyNotifications(10)).toEqual([{ id: "n1" }])
    expect(mocks.parseLimit).toHaveBeenCalledWith(10)
    expect(mocks.readList).toHaveBeenCalledWith(context, 10)
  })

  it("returns an empty list when the caller is not an active member", async () => {
    mocks.requireContext.mockRejectedValue(new Error("Forbidden: league access unavailable"))
    expect(await getMyNotifications(10)).toEqual([])
  })

  it("returns zero when the caller is unauthenticated or league-less", async () => {
    mocks.requireContext.mockRejectedValue(new Error("Unauthorized"))
    expect(await getUnreadCount()).toBe(0)
    mocks.requireContext.mockRejectedValue(new Error("Tenant not found"))
    expect(await getUnreadCount()).toBe(0)
  })

  it("propagates a genuine infrastructure failure instead of faking empty data", async () => {
    mocks.requireContext.mockRejectedValue(new Error("database unavailable"))
    await expect(getMyNotifications(10)).rejects.toThrow("database unavailable")
    await expect(getUnreadCount()).rejects.toThrow("database unavailable")
  })

  it("marks one notification read and returns success for a member", async () => {
    expect(await markNotificationRead("00000000-0000-4000-8000-000000000003"))
      .toEqual({ success: true })
    expect(mocks.markOne).toHaveBeenCalledWith(context, "00000000-0000-4000-8000-000000000003")
  })

  it("refuses to mutate for a non-member caller", async () => {
    mocks.requireContext.mockRejectedValue(new Error("Forbidden: league access unavailable"))
    await expect(markNotificationRead("00000000-0000-4000-8000-000000000003")).rejects.toThrow("Forbidden")
    await expect(markAllNotificationsRead()).rejects.toThrow("Forbidden")
    expect(mocks.markAll).not.toHaveBeenCalled()
  })
})
