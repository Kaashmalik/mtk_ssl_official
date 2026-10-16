import React from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import MembersPage from "@/app/dashboard/users/page"
import SettingsMembersPage from "@/app/dashboard/settings/members/page"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), access: vi.fn(), members: vi.fn(), assignments: vi.fn(), transfer: vi.fn(),
  table: vi.fn(() => null),
}))
const redirects = vi.hoisted(() => ({ calls: [] as string[] }))
vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }))
vi.mock("next/navigation", () => ({
  redirect: (href: string) => { redirects.calls.push(href); throw new Error(`redirect:${href}`) },
}))
vi.mock("next/cache", () => ({ unstable_noStore: () => {} }))
vi.mock("@/lib/dashboard-context", () => ({ getDashboardContext: mocks.access }))
vi.mock("@/app/actions/users", () => ({ getMemberDirectory: mocks.members }))
vi.mock("@/app/actions/ownership", () => ({ getOwnershipTransfer: mocks.transfer }))
vi.mock("@/lib/member-assignments", () => ({ readMemberAssignments: mocks.assignments }))
vi.mock("@/components/users/user-list-table", () => ({ UserListTable: mocks.table }))
vi.mock("@/components/users/invite-manager", () => ({ InviteManager: () => null }))
vi.mock("@/components/settings/ownership-transfer-panel", () => ({ OwnershipTransferPanel: () => null }))
vi.mock("@mtk/ui/components/ui/motion-wrapper", () => ({ MotionWrapper: () => null }))

const TENANT = "00000000-0000-4000-8000-000000000001"
const MEMBER = "00000000-0000-4000-8000-000000000002"
const context = { tenantId: TENANT, tenantName: "League A", actorId: "owner", role: "league_owner" }
const members = [{ id: MEMBER, membershipId: "membership" }]
const assignments = { [MEMBER]: { managedTeams: [], scoringMatches: [], isComplete: false } }

function tableProps(node: unknown): Record<string, unknown> | undefined {
  if (!React.isValidElement(node)) return undefined
  if (node.type === mocks.table) return node.props as Record<string, unknown>
  const props = node.props as { children?: React.ReactNode }
  return React.Children.toArray(props.children).map(tableProps).find(Boolean)
}

beforeEach(() => {
  vi.resetAllMocks()
  redirects.calls.length = 0
  mocks.auth.mockResolvedValue({ userId: "clerk" })
  mocks.access.mockResolvedValue({ status: "ready", context })
  mocks.members.mockResolvedValue({ members, nextCursor: null })
  mocks.assignments.mockResolvedValue(assignments)
  mocks.transfer.mockResolvedValue(null)
})

describe("Members page authorization and assignment wiring (mocked, not browser acceptance)", () => {
  it("keeps the settings alias on the same guarded page", () => {
    expect(SettingsMembersPage).toBe(MembersPage)
  })

  it("reads only the resolved league's loaded member assignments and preserves completeness metadata", async () => {
    const tree = await MembersPage({})
    expect(mocks.access).toHaveBeenCalledWith("clerk")
    expect(mocks.members).toHaveBeenCalledWith(expect.objectContaining({ tenantId: TENANT, q: "", role: "all", status: "all" }))
    expect(mocks.assignments).toHaveBeenCalledWith(TENANT, [MEMBER])
    expect(tableProps(tree)).toMatchObject({ initialUsers: members, assignments, tenantId: TENANT, currentUserId: "owner" })
  })

  it("redirects an anonymous visit before checking access", async () => {
    mocks.auth.mockResolvedValue({ userId: null })
    await expect(MembersPage({})).rejects.toThrow("redirect:/")
    expect(mocks.access).not.toHaveBeenCalled()
    expect(mocks.members).not.toHaveBeenCalled()
  })

  it.each(["denied", "no-tenant"])("redirects confirmed %s access without reading private data", async status => {
    mocks.access.mockResolvedValue({ status })
    await expect(MembersPage({})).rejects.toThrow("redirect:/dashboard")
    expect(mocks.members).not.toHaveBeenCalled()
    expect(mocks.assignments).not.toHaveBeenCalled()
  })

  it.each(["scorer", "team_manager", "super_admin", "fan"])("refuses private member data to %s", async role => {
    mocks.access.mockResolvedValue({ status: "ready", context: { ...context, role } })
    await expect(MembersPage({})).rejects.toThrow("redirect:/dashboard")
    expect(mocks.members).not.toHaveBeenCalled()
    expect(mocks.assignments).not.toHaveBeenCalled()
  })

  it("surfaces access unavailability rather than redirecting it as a denial", async () => {
    mocks.access.mockResolvedValue({ status: "unavailable" })
    await expect(MembersPage({})).rejects.toThrow("League member access is unavailable")
    expect(redirects.calls).toEqual([])
    expect(mocks.members).not.toHaveBeenCalled()
  })

  it.each(["access", "members", "assignments", "transfer"] as const)("propagates %s failure instead of a redirect or fake empty state", async source => {
    mocks[source].mockRejectedValue(new Error("Database unavailable"))
    await expect(MembersPage({})).rejects.toThrow("Database unavailable")
    expect(redirects.calls).toEqual([])
  })

  it("passes validated directory filters to the owner-gated reader", async () => {
    const tree = await MembersPage({ searchParams: Promise.resolve({ q: " Ali ", role: "scorer", status: "active", after: MEMBER }) })
    expect(mocks.members).toHaveBeenCalledWith({ tenantId: TENANT, q: "Ali", role: "scorer", status: "active", after: MEMBER })
    expect(tableProps(tree)?.directoryMode).toBe(true)
  })

  it.each([{ after: "invalid" }, { q: ["Ali", "Bob"] }, { role: "invalid" }, { status: "blocked" }])("does not query a directory for invalid input %s", async search => {
    await MembersPage({ searchParams: Promise.resolve(search) })
    expect(mocks.members).not.toHaveBeenCalled()
    expect(mocks.assignments).not.toHaveBeenCalled()
    expect(mocks.transfer).not.toHaveBeenCalled()
    expect(redirects.calls).toEqual([])
  })
})
