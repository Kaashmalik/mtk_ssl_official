import { beforeEach, describe, expect, it, vi } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import { resolveDefaultTenantId, verifyTenantMembership } from "../tenant-context"
const mocks = vi.hoisted(() => ({ user: vi.fn(), member: vi.fn(), tenant: vi.fn(),
  select: vi.fn(), from: vi.fn(), join: vi.fn(), where: vi.fn(), order: vi.fn(), limit: vi.fn(),
}))
vi.mock("../client", () => ({ db: { query: {
  users: { findFirst: mocks.user }, userTenantRoles: { findFirst: mocks.member }, tenants: { findFirst: mocks.tenant },
}, select: mocks.select } }))
const actor = { id: "ali", isActive: true, role: "league_owner", tenantIds: ["A", "B", "C"] }
beforeEach(() => {
  vi.resetAllMocks()
  mocks.user.mockResolvedValue(actor)
  mocks.member.mockResolvedValue({ userId: "ali", tenantId: "A", role: "scorer", status: "active" })
  mocks.tenant.mockResolvedValue({ id: "A", isActive: true })
  mocks.select.mockReturnValue({ from: mocks.from }); mocks.from.mockReturnValue({ innerJoin: mocks.join })
  mocks.join.mockReturnValue({ where: mocks.where }); mocks.where.mockReturnValue({ orderBy: mocks.order })
  mocks.order.mockReturnValue({ limit: mocks.limit }); mocks.limit.mockResolvedValue([{ tenantId: "A" }])
})
describe("Exported database membership helpers do not preserve legacy authority", () => {
  it("A is scorer, B is suspended, C is absent regardless of global legacy role", async () => {
    expect(await verifyTenantMembership("clerk-ali", "A")).toBe("scorer")
    mocks.member.mockResolvedValue({ userId: "ali", tenantId: "B", role: "league_owner", status: "suspended" })
    expect(await verifyTenantMembership("clerk-ali", "B")).toBeNull()
    mocks.member.mockResolvedValue(null)
    expect(await verifyTenantMembership("clerk-ali", "C")).toBeNull()
  })
  it.each([undefined, { ...actor, isActive: false }])("unavailable account %s cannot resolve or verify a league", async user => {
    mocks.user.mockResolvedValue(user)
    expect(await verifyTenantMembership("clerk-ali", "A")).toBeNull()
    expect(await resolveDefaultTenantId("clerk-ali")).toBeNull()
    expect(mocks.member).not.toHaveBeenCalled()
    expect(mocks.select).not.toHaveBeenCalled()
  })
  it.each([{ userId: "other", tenantId: "A", status: "active", role: "scorer" },
    { userId: "ali", tenantId: "B", status: "active", role: "scorer" },
    { userId: "ali", tenantId: "A", status: "active", role: "super_admin" }])("rejects invalid scope/role %s", async member => {
    mocks.member.mockResolvedValue(member)
    expect(await verifyTenantMembership("clerk-ali", "A")).toBeNull()
  })
  it.each([undefined, { id: "A", isActive: false }, { id: "B", isActive: true }])("rejects invalid league %s", async tenant => {
    mocks.tenant.mockResolvedValue(tenant)
    expect(await verifyTenantMembership("clerk-ali", "A")).toBeNull()
  })
  it("default lookup filters active member/league and never reads legacy arrays", async () => {
    expect(await resolveDefaultTenantId("clerk-ali")).toBe("A")
    expect(new PgDialect().sqlToQuery(mocks.where.mock.calls[0][0]).params).toEqual(["ali", "active", "super_admin", true])
    expect(mocks.limit).toHaveBeenCalledWith(1)
    mocks.limit.mockResolvedValue([])
    expect(await resolveDefaultTenantId("clerk-ali")).toBeNull()
  })
  it("lookup errors propagate rather than granting legacy access", async () => {
    mocks.member.mockRejectedValue(new Error("Unavailable"))
    await expect(verifyTenantMembership("clerk-ali", "A")).rejects.toThrow("Unavailable")
  })
})
