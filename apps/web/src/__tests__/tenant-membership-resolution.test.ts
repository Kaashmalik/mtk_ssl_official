import { beforeEach, describe, expect, it, vi } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import { getMyTenant } from "@/app/actions/tenants"

const mocks = vi.hoisted(() => ({ auth: vi.fn(), host: vi.fn(), member: vi.fn(), select: vi.fn(),
  from: vi.fn(), where: vi.fn(), limit: vi.fn(), join: vi.fn(), order: vi.fn(),
}))
vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }))
vi.mock("@/lib/tenant", () => ({ getTenantFromRequest: mocks.host }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@mtk/database", async original => ({ ...await original<typeof import("@mtk/database")>(), db: {
  select: mocks.select, query: { userTenantRoles: { findFirst: mocks.member } },
} }))
beforeEach(() => {
  vi.resetAllMocks()
  mocks.auth.mockResolvedValue({ userId: "clerk-ali" })
  mocks.host.mockResolvedValue({ id: "A", isActive: true })
  mocks.member.mockResolvedValue({ userId: "ali", tenantId: "A", status: "active", role: "scorer" })
  mocks.select.mockReturnValue({ from: mocks.from })
  mocks.from.mockReturnValue({ where: mocks.where, innerJoin: mocks.join })
  mocks.join.mockReturnValue({ where: mocks.where })
  mocks.where.mockReturnValue({ limit: mocks.limit, orderBy: mocks.order })
  mocks.order.mockReturnValue({ limit: mocks.limit })
  mocks.limit.mockResolvedValueOnce([{ id: "ali", isActive: true }])
    .mockResolvedValue([{ tenant: { id: "B", isActive: true } }])
})
describe("One league context for guarded actions and their database work", () => {
  it("uses authorized host A, never the primary B", async () => {
    expect(await getMyTenant()).toEqual({ id: "A", isActive: true })
    expect(mocks.select).toHaveBeenCalledTimes(1)
    expect(new PgDialect().sqlToQuery(mocks.member.mock.calls[0][0].where).params).toEqual(["ali", "A"])
  })
  it.each([null, { userId: "ali", tenantId: "A", status: "suspended", role: "league_owner" },
    { userId: "ali", tenantId: "B", status: "active", role: "scorer" },
    { userId: "ali", tenantId: "A", status: "active", role: "super_admin" },
    { userId: "other", tenantId: "A", status: "active", role: "scorer" }])("denied host membership never switches leagues %s", async member => {
    mocks.member.mockResolvedValue(member)
    expect(await getMyTenant()).toBeNull()
    expect(mocks.select).toHaveBeenCalledTimes(1)
  })
  it("only resolves default active membership when host resolution succeeds empty", async () => {
    mocks.host.mockResolvedValue(null)
    expect(await getMyTenant()).toEqual({ id: "B", isActive: true })
    const query = new PgDialect().sqlToQuery(mocks.where.mock.calls[1][0])
    expect(query.params).toEqual(["ali", "active", "super_admin", true])
    expect(mocks.member).not.toHaveBeenCalled()
  })
  it("absent explicit membership never falls back to tenants.owner_id", async () => {
    mocks.host.mockResolvedValue(null)
    mocks.limit.mockReset().mockResolvedValueOnce([{ id: "ali", isActive: true }]).mockResolvedValue([])
    expect(await getMyTenant()).toBeNull()
    expect(mocks.select).toHaveBeenCalledTimes(2)
  })
  it.each(["host", "member"])("lookup %s failure propagates without a primary/owner fallback", async key => {
    mocks[key as "host" | "member"].mockRejectedValue(new Error("Unavailable"))
    await expect(getMyTenant()).rejects.toThrow("Unavailable")
    expect(mocks.select).toHaveBeenCalledTimes(1)
  })
  it("inactive account never resolves a workspace", async () => {
    mocks.limit.mockReset().mockResolvedValue([{ id: "ali", isActive: false }])
    expect(await getMyTenant()).toBeNull()
    expect(mocks.host).not.toHaveBeenCalled()
  })
  it("recognizes an inactive host instead of choosing unrelated primary membership", async () => {
    mocks.host.mockResolvedValue({ id: "A", isActive: false })
    expect(await getMyTenant()).toBeNull()
    expect(mocks.host).toHaveBeenCalledWith(true)
    expect(mocks.select).toHaveBeenCalledTimes(1)
  })
})
