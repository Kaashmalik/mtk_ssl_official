import React from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import RegistrationsPage from "@/app/dashboard/registrations/page"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), access: vi.fn(), list: vi.fn(), listView: vi.fn(() => null),
}))
const redirects = vi.hoisted(() => ({ calls: [] as string[] }))

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }))
vi.mock("next/navigation", () => ({
  redirect: (href: string) => { redirects.calls.push(href); throw new Error(`redirect:${href}`) },
}))
vi.mock("@/lib/registration-reads", () => ({
  resolveRegistrationReviewAccess: mocks.access,
  readRegistrations: mocks.list,
}))
vi.mock("@/components/registrations/registration-list", () => ({ RegistrationList: mocks.listView }))
vi.mock("@mtk/ui/components/ui/motion-wrapper", () => ({
  MotionWrapper: ({ children }: { children?: React.ReactNode }) => children,
}))

const TENANT = "00000000-0000-4000-8000-000000000001"
const context = { tenantId: TENANT, actorId: "actor", clerkId: "clerk", role: "league_owner" }
const row = {
  id: "reg-1", teamName: "Falcons", tournamentName: "Summer Cup", squadPlayerIds: ["p1", "p2"],
  registrationFee: "150", notes: "early", status: "pending", paymentStatus: "unpaid",
  createdAt: new Date("2026-10-15T00:00:00.000Z"),
}

/** Walks the element tree the page returns and collects any `initialRegistrations` prop. */
function collectRegistrations(node: unknown, out: unknown[] = []): unknown[] {
  if (!React.isValidElement(node)) return out
  const props = node.props as { children?: React.ReactNode; initialRegistrations?: unknown }
  if ("initialRegistrations" in props) out.push(props.initialRegistrations)
  React.Children.forEach(props.children, (child) => collectRegistrations(child, out))
  return out
}

beforeEach(() => {
  vi.resetAllMocks()
  redirects.calls.length = 0
  mocks.listView.mockImplementation(() => null)
  mocks.auth.mockResolvedValue({ userId: "clerk" })
  mocks.access.mockResolvedValue(context)
  mocks.list.mockResolvedValue({ data: [row], pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 } })
})

describe("Registrations review queue scopes to the exact active league", () => {
  it("reads the queue for the resolved league and hands the mapped rows to the list", async () => {
    const tree = await RegistrationsPage()
    expect(mocks.access).toHaveBeenCalledTimes(1)
    expect(mocks.list).toHaveBeenCalledWith(TENANT, { pageSize: 100 })
    const [rows] = collectRegistrations(tree) as [Array<Record<string, unknown>>]
    expect(rows[0]).toMatchObject({
      id: "reg-1", teamName: "Falcons", tournamentName: "Summer Cup",
      squadCount: 2, registrationFee: "150", status: "pending", paymentStatus: "unpaid",
    })
  })

  it("attaches the shared policy's truthful eligibility sentence to every row (ENH-05-03 slice 3)", async () => {
    mocks.list.mockResolvedValue({ data: [
      row,
      { ...row, id: "reg-2", status: "approved", paymentStatus: "paid" },
    ], pagination: { page: 1, pageSize: 100, total: 2, totalPages: 1 } })
    const tree = await RegistrationsPage()
    const [rows] = collectRegistrations(tree) as [Array<Record<string, unknown>>]
    // Every separate gate is named; the not-configured minimum is shown, never hidden.
    expect(rows[0].eligibility).toBe("Not eligible yet: registration must be approved; registration fee must be paid or waived; tournament minimum squad size is not configured.")
    expect(rows[1].eligibility).toBe("Not eligible yet: tournament minimum squad size is not configured.")
  })

  it("sends a non-owner to the dashboard without reading the queue", async () => {
    mocks.access.mockResolvedValue(null)
    await expect(RegistrationsPage()).rejects.toThrow("redirect:/dashboard")
    expect(mocks.list).not.toHaveBeenCalled()
  })

  it.each(["Database unavailable", "Tenant lookup failed"])(
    "propagates %s instead of treating it like a non-owner visit", async (message) => {
      mocks.access.mockRejectedValue(new Error(message))
      await expect(RegistrationsPage()).rejects.toThrow(message)
      expect(redirects.calls).not.toContain("/dashboard")
      expect(mocks.list).not.toHaveBeenCalled()
    })

  it("propagates a queue read failure instead of rendering an empty queue", async () => {
    mocks.list.mockRejectedValue(new Error("Database unavailable"))
    await expect(RegistrationsPage()).rejects.toThrow("Database unavailable")
    expect(redirects.calls).toEqual([])
  })

  it("redirects an anonymous visit to the landing page before resolving access", async () => {
    mocks.auth.mockResolvedValue({ userId: null })
    await expect(RegistrationsPage()).rejects.toThrow("redirect:/")
    expect(mocks.access).not.toHaveBeenCalled()
  })
})
