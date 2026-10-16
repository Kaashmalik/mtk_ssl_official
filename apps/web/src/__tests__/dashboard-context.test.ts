import { beforeEach, describe, expect, it, vi } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import { getDashboardContext } from "@/lib/dashboard-context"

const mocks = vi.hoisted(() => ({ host: vi.fn(), primary: vi.fn(), user: vi.fn(), membership: vi.fn(), tenant: vi.fn() }))
vi.mock("@/lib/tenant", () => ({ getTenantFromRequest: mocks.host }))
vi.mock("@/app/actions/tenants", () => ({ getMyTenant: mocks.primary }))
vi.mock("@mtk/database", async (importOriginal) => ({
  ...await importOriginal<typeof import("@mtk/database")>(),
  db: { query: { users: { findFirst: mocks.user }, userTenantRoles: { findFirst: mocks.membership }, tenants: { findFirst: mocks.tenant } } },
}))
const actor = { id: "actor", isActive: true, role: "league_owner", tenantIds: ["tenant", "primary"] }
beforeEach(() => {
  vi.resetAllMocks()
  mocks.host.mockResolvedValue({ id: "tenant" })
  mocks.primary.mockResolvedValue({ id: "primary" })
  mocks.user.mockResolvedValue(actor)
  mocks.membership.mockResolvedValue({ userId: "actor", tenantId: "tenant", role: "scorer", status: "active" })
  mocks.tenant.mockResolvedValue({ id: "tenant", name: "League", isActive: true })
})

describe("Authorized active workspace context", () => {
  it.each(["suspended", "pending", undefined])("denies membership status %s without falling back", async status => {
    mocks.membership.mockResolvedValue({ userId: "actor", tenantId: "tenant", role: "league_owner", status })
    expect(await getDashboardContext("clerk")).toEqual({ status: "denied" })
    expect(mocks.tenant).not.toHaveBeenCalled()
  })
  it("denies an active membership whose expiry bound passed or is unparseable (SCORE-09)", async () => {
    mocks.membership.mockResolvedValue({ userId: "actor", tenantId: "tenant", role: "league_owner", status: "active", expiresAt: new Date("2020-01-01T00:00:00Z") })
    expect(await getDashboardContext("clerk")).toEqual({ status: "denied" })
    mocks.membership.mockResolvedValue({ userId: "actor", tenantId: "tenant", role: "league_owner", status: "active", expiresAt: "not-a-date" })
    expect(await getDashboardContext("clerk")).toEqual({ status: "denied" })
  })
  it("uses the host tenant and its role, not primary membership or global privilege", async () => {
    expect(await getDashboardContext("clerk-session")).toEqual({ status: "ready", context: { actorId: "actor", tenantId: "tenant", tenantName: "League", role: "scorer" } })
    expect(mocks.primary).not.toHaveBeenCalled()
    const dialect = new PgDialect()
    expect(dialect.sqlToQuery(mocks.user.mock.calls[0][0].where).params).toEqual(["clerk-session"])
    expect(dialect.sqlToQuery(mocks.membership.mock.calls[0][0].where).params).toEqual(["actor", "tenant"])
    expect(dialect.sqlToQuery(mocks.tenant.mock.calls[0][0].where).params).toEqual(["tenant", true])
  })
  it("uses primary tenant only when no request tenant was resolved", async () => {
    mocks.host.mockResolvedValue(null)
    mocks.membership.mockResolvedValue({ userId: "actor", tenantId: "primary", role: "coach", status: "active" })
    mocks.tenant.mockResolvedValue({ id: "primary", name: "Primary league", isActive: true })
    expect(await getDashboardContext("clerk")).toMatchObject({ status: "ready", context: { tenantId: "primary", role: "coach" } })
  })
  it("returns no-tenant only for a successful empty resolution", async () => {
    mocks.host.mockResolvedValue(null)
    mocks.primary.mockResolvedValue(null)
    expect(await getDashboardContext("clerk")).toEqual({ status: "no-tenant" })
    expect(mocks.membership).not.toHaveBeenCalled()
  })
  it.each([undefined, { ...actor, isActive: false }])("rejects unprovisioned/inactive accounts %s", async (user) => {
    mocks.user.mockResolvedValue(user)
    expect(await getDashboardContext("clerk")).toEqual({ status: "denied" })
    expect(mocks.membership).not.toHaveBeenCalled()
  })
  it("does not treat an unrelated host as membership, even for a global super admin", async () => {
    mocks.user.mockResolvedValue({ ...actor, role: "super_admin", tenantIds: ["primary"] })
    mocks.membership.mockResolvedValue(null)
    expect(await getDashboardContext("clerk")).toEqual({ status: "denied" })
    expect(mocks.tenant).not.toHaveBeenCalled()
  })
  it("denies absent membership even when legacy arrays/role still grant access", async () => {
    mocks.membership.mockResolvedValue(null)
    expect(await getDashboardContext("clerk")).toEqual({ status: "denied" })
  })
  it("honors a lower-privilege junction role rather than upgrading to legacy owner", async () => {
    mocks.membership.mockResolvedValue({ userId: "actor", tenantId: "tenant", role: "fan", status: "active" })
    expect(await getDashboardContext("clerk")).toMatchObject({ status: "ready", context: { role: "fan" } })
  })
  it.each([{ userId: "other", tenantId: "tenant", role: "league_owner" },
    { userId: "actor", tenantId: "foreign", role: "league_owner" },
    { userId: "actor", tenantId: "tenant", role: null }])("rejects mismatched or invalid memberships %s", async (membership) => {
    mocks.membership.mockResolvedValue(membership)
    expect(await getDashboardContext("clerk")).toEqual({ status: "denied" })
  })
  it.each([undefined, { id: "tenant", isActive: false }, { id: "foreign", isActive: true }])("rejects absent, inactive, or mismatched tenants %s", async (tenant) => {
    mocks.tenant.mockResolvedValue(tenant)
    expect(await getDashboardContext("clerk")).toEqual({ status: "denied" })
  })
  it.each(["host", "primary", "user", "membership", "tenant"])("fails closed on %s lookup errors without fallback", async (key) => {
    if (key === "primary") mocks.host.mockResolvedValue(null)
    mocks[key as keyof typeof mocks].mockRejectedValue(new Error("database unavailable"))
    expect(await getDashboardContext("clerk")).toEqual({ status: "unavailable" })
    if (key === "host") expect(mocks.primary).not.toHaveBeenCalled()
  })
})
