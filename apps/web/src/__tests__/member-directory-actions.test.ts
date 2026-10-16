import { beforeEach, describe, expect, it, vi } from "vitest"
import { getMemberDirectory, getMemberDetails } from "@/app/actions/users"

const mocks = vi.hoisted(() => ({ auth: vi.fn(), context: vi.fn(), directory: vi.fn(), detail: vi.fn() }))
vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }))
vi.mock("@/lib/dashboard-context", () => ({ getDashboardContext: mocks.context }))
vi.mock("@/lib/member-directory", () => ({ readMemberDirectory: mocks.directory, readMemberDetails: mocks.detail }))
const TENANT = "00000000-0000-4000-8000-000000000001"
const OTHER = "00000000-0000-4000-8000-000000000002"
const MEMBER = "00000000-0000-4000-8000-000000000003"
const context = { tenantId: TENANT, actorId: "owner", role: "league_owner" }

beforeEach(() => {
  vi.resetAllMocks()
  mocks.auth.mockResolvedValue({ userId: "clerk-owner" })
  mocks.context.mockResolvedValue({ status: "ready", context })
  mocks.directory.mockResolvedValue({ members: [], nextCursor: null })
  mocks.detail.mockResolvedValue(null)
})

describe("Owner-only member directory action boundaries", () => {
  it("delegates the directory read with the session-resolved tenant and normalized filters", async () => {
    await getMemberDirectory({ tenantId: TENANT, q: " Ali " })
    expect(mocks.directory).toHaveBeenCalledWith(TENANT, { q: "Ali", status: "all", role: "all" })
  })
  it("delegates an exact membership detail read", async () => {
    await getMemberDetails({ tenantId: TENANT, membershipId: MEMBER })
    expect(mocks.detail).toHaveBeenCalledWith(TENANT, MEMBER)
  })
  it.each(["directory", "detail"])("rejects stale/foreign tenant input for %s before reading", async kind => {
    await expect(kind === "directory" ? getMemberDirectory({ tenantId: OTHER }) : getMemberDetails({ tenantId: OTHER, membershipId: MEMBER })).rejects.toThrow("Workspace changed")
    expect(mocks.directory).not.toHaveBeenCalled()
    expect(mocks.detail).not.toHaveBeenCalled()
  })
  it.each(["team_manager", "scorer", "fan", "super_admin"])("does not expose private contact fields to %s", async role => {
    mocks.context.mockResolvedValue({ status: "ready", context: { ...context, role } })
    await expect(getMemberDirectory({ tenantId: TENANT })).rejects.toThrow("Forbidden")
    await expect(getMemberDetails({ tenantId: TENANT, membershipId: MEMBER })).rejects.toThrow("Forbidden")
    expect(mocks.directory).not.toHaveBeenCalled()
    expect(mocks.detail).not.toHaveBeenCalled()
  })
  it.each(["denied", "no-tenant"])("refuses context %s", async status => {
    mocks.context.mockResolvedValue({ status })
    await expect(getMemberDirectory({ tenantId: TENANT })).rejects.toThrow("Forbidden")
    expect(mocks.directory).not.toHaveBeenCalled()
  })
  it("reports unavailability rather than mislabelling it as permission denial", async () => {
    mocks.context.mockResolvedValue({ status: "unavailable" })
    await expect(getMemberDirectory({ tenantId: TENANT })).rejects.toThrow("access is unavailable")
    expect(mocks.directory).not.toHaveBeenCalled()
  })
  it("requires an authenticated session before any directory read", async () => {
    mocks.auth.mockResolvedValue({ userId: null })
    await expect(getMemberDirectory({ tenantId: TENANT })).rejects.toThrow("Unauthorized")
    await expect(getMemberDetails({ tenantId: TENANT, membershipId: MEMBER })).rejects.toThrow("Unauthorized")
    expect(mocks.directory).not.toHaveBeenCalled()
    expect(mocks.detail).not.toHaveBeenCalled()
  })
  it("validates filters and detail keys before calling readers", async () => {
    await expect(getMemberDirectory({ tenantId: TENANT, after: "invalid" })).rejects.toThrow()
    await expect(getMemberDetails({ tenantId: TENANT, membershipId: "invalid" })).rejects.toThrow()
    expect(mocks.directory).not.toHaveBeenCalled()
    expect(mocks.detail).not.toHaveBeenCalled()
  })
  it("propagates failures in the scoped readers", async () => {
    mocks.directory.mockRejectedValue(new Error("Database unavailable"))
    mocks.detail.mockRejectedValue(new Error("Database unavailable"))
    await expect(getMemberDirectory({ tenantId: TENANT })).rejects.toThrow("Database unavailable")
    await expect(getMemberDetails({ tenantId: TENANT, membershipId: MEMBER })).rejects.toThrow("Database unavailable")
  })
})
