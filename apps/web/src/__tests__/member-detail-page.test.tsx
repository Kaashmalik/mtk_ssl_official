import React from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import MemberDetailsPage from "@/app/dashboard/settings/members/[membershipId]/page"

const mocks = vi.hoisted(() => ({ auth: vi.fn(), access: vi.fn(), detail: vi.fn(), assignments: vi.fn(), table: vi.fn(() => null) }))
const routes = vi.hoisted(() => ({ redirects: [] as string[], notFound: vi.fn() }))
vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }))
vi.mock("next/cache", () => ({ unstable_noStore: () => {} }))
vi.mock("next/navigation", () => ({
  redirect: (href: string) => { routes.redirects.push(href); throw new Error(`redirect:${href}`) },
  notFound: () => { routes.notFound(); throw new Error("not-found") },
}))
vi.mock("@/lib/dashboard-context", () => ({ getDashboardContext: mocks.access }))
vi.mock("@/app/actions/users", () => ({ getMemberDetails: mocks.detail }))
vi.mock("@/lib/member-assignments", () => ({ readMemberAssignments: mocks.assignments }))
vi.mock("@/components/users/user-list-table", () => ({ UserListTable: mocks.table }))
const TENANT = "00000000-0000-4000-8000-000000000001"
const MEMBER = "00000000-0000-4000-8000-000000000002"
const ACCOUNT = "00000000-0000-4000-8000-000000000003"
const context = { tenantId: TENANT, tenantName: "League A", actorId: "owner", role: "league_owner" }
const member = { id: ACCOUNT, membershipId: MEMBER }
const assignments = { [ACCOUNT]: { managedTeams: [], scoringMatches: [], isComplete: true } }
const visit = (membershipId = MEMBER) => MemberDetailsPage({ params: Promise.resolve({ membershipId }) })

function findTable(node: unknown): Record<string, unknown> | undefined {
  if (!React.isValidElement(node)) return undefined
  if (node.type === mocks.table) return node.props as Record<string, unknown>
  return React.Children.toArray((node.props as { children?: React.ReactNode }).children).map(findTable).find(Boolean)
}

beforeEach(() => {
  vi.resetAllMocks()
  routes.redirects.length = 0
  mocks.auth.mockResolvedValue({ userId: "clerk-owner" })
  mocks.access.mockResolvedValue({ status: "ready", context })
  mocks.detail.mockResolvedValue(member)
  mocks.assignments.mockResolvedValue(assignments)
})

describe("Owner-only member details page", () => {
  it("loads only the exact membership and account assignments in the active league", async () => {
    const tree = await visit()
    expect(mocks.detail).toHaveBeenCalledWith({ tenantId: TENANT, membershipId: MEMBER })
    expect(mocks.assignments).toHaveBeenCalledWith(TENANT, [ACCOUNT])
    expect(findTable(tree)).toMatchObject({ initialUsers: [member], assignments, tenantId: TENANT, currentUserId: "owner", directoryMode: true })
  })
  it("redirects anonymous visitors without reading member data", async () => {
    mocks.auth.mockResolvedValue({ userId: null })
    await expect(visit()).rejects.toThrow("redirect:/")
    expect(mocks.detail).not.toHaveBeenCalled()
  })
  it.each(["scorer", "team_manager", "fan", "super_admin"])("refuses private member details to %s", async role => {
    mocks.access.mockResolvedValue({ status: "ready", context: { ...context, role } })
    await expect(visit()).rejects.toThrow("redirect:/dashboard")
    expect(mocks.detail).not.toHaveBeenCalled()
    expect(mocks.assignments).not.toHaveBeenCalled()
  })
  it("returns 404 for a malformed membership ID without reading", async () => {
    await expect(visit("invalid")).rejects.toThrow("not-found")
    expect(mocks.detail).not.toHaveBeenCalled()
  })
  it("returns 404 for a missing/foreign league membership", async () => {
    mocks.detail.mockResolvedValue(null)
    await expect(visit()).rejects.toThrow("not-found")
    expect(mocks.assignments).not.toHaveBeenCalled()
  })
  it("surfaces an unavailable authority check instead of redirecting", async () => {
    mocks.access.mockResolvedValue({ status: "unavailable" })
    await expect(visit()).rejects.toThrow("access is unavailable")
    expect(routes.redirects).toEqual([])
    expect(routes.notFound).not.toHaveBeenCalled()
  })
  it.each(["access", "detail", "assignments"] as const)("propagates %s failure without a false empty/404 response", async source => {
    mocks[source].mockRejectedValue(new Error("Database unavailable"))
    await expect(visit()).rejects.toThrow("Database unavailable")
    expect(routes.redirects).toEqual([])
    expect(routes.notFound).not.toHaveBeenCalled()
  })
})
