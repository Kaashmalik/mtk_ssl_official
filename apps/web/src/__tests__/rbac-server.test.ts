import { beforeEach, describe, expect, it, vi } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import { getUserRoleForTenant, hasPermissionServer, requirePermissionServer, resolveActiveTenantId, resolveMemberTenantId } from "@/lib/rbac-server"

const mocks = vi.hoisted(() => ({ auth: vi.fn(), user: vi.fn(), member: vi.fn(), tenant: vi.fn(), host: vi.fn(), primary: vi.fn() }))
vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }))
vi.mock("@/lib/tenant", () => ({ getTenantFromRequest: mocks.host }))
vi.mock("@/app/actions/tenants", () => ({ getMyTenant: mocks.primary }))
vi.mock("@mtk/database", async original => ({ ...await original<typeof import("@mtk/database")>(), db: { query: {
  users: { findFirst: mocks.user }, userTenantRoles: { findFirst: mocks.member }, tenants: { findFirst: mocks.tenant },
} } }))
const user = { id: "ali", isActive: true, role: "super_admin", tenantIds: ["A", "B", "C"] }
const member = { userId: "ali", tenantId: "A", role: "scorer", status: "active" }
beforeEach(() => {
  vi.resetAllMocks()
  mocks.auth.mockResolvedValue({ userId: "clerk-ali" })
  mocks.user.mockResolvedValue(user)
  mocks.member.mockResolvedValue(member)
  mocks.tenant.mockResolvedValue({ id: "A", isActive: true })
  mocks.host.mockResolvedValue({ id: "A" })
  mocks.primary.mockResolvedValue({ id: "B" })
})
describe("Fail-closed exact-league RBAC", () => {
  it("authorizes the exact membership rather than the global role", async () => {
    expect(await hasPermissionServer("match:score", "A")).toBe(true)
    expect(await hasPermissionServer("user:manage", "A")).toBe(false)
    const dialect = new PgDialect()
    expect(dialect.sqlToQuery(mocks.member.mock.calls[0][0].where).params).toEqual(["ali", "A"])
    expect(mocks.host).not.toHaveBeenCalled()
  })
  it("allows A, denies suspended B and absent C even if legacy arrays contain all three", async () => {
    for (const [tenantId, membership, allowed] of [["A", member, true], ["B", { ...member, tenantId: "B", status: "suspended" }, false], ["C", null, false]] as const) {
      mocks.member.mockResolvedValue(membership)
      mocks.tenant.mockResolvedValue({ id: tenantId, isActive: true })
      expect(await hasPermissionServer("match:score", tenantId)).toBe(allowed)
    }
  })
  it.each(["suspended", "revoked", "expired", "pending", undefined])("status %s cannot fall back to global privileges", async status => {
    mocks.member.mockResolvedValue({ ...member, status })
    expect(await hasPermissionServer("match:score", "A")).toBe(false)
  })
  it.each([new Date("2020-01-01T00:00:00Z"), "not-a-date"])("an active membership whose bound has passed or is unparseable is denied (SCORE-09)", async expiresAt => {
    mocks.member.mockResolvedValue({ ...member, status: "active", expiresAt })
    expect(await hasPermissionServer("match:score", "A")).toBe(false)
    expect(await hasPermissionServer("user:manage", "A")).toBe(false)
  })
  it.each([null, { ...member, userId: "other" }, { ...member, tenantId: "B" }, { ...member, role: "super_admin" }])("rejects absent/mismatched/platform membership %s", async membership => {
    mocks.member.mockResolvedValue(membership)
    expect(await hasPermissionServer("user:manage", "A")).toBe(false)
  })
  it.each([undefined, { ...user, isActive: false }])("rejects inactive/unprovisioned account %s", async actor => {
    mocks.user.mockResolvedValue(actor)
    expect(await hasPermissionServer("match:score", "A")).toBe(false)
    expect(mocks.member).not.toHaveBeenCalled()
  })
  it.each([undefined, { id: "A", isActive: false }, { id: "B", isActive: true }])("rejects unavailable/foreign league %s", async tenant => {
    mocks.tenant.mockResolvedValue(tenant)
    expect(await hasPermissionServer("match:score", "A")).toBe(false)
  })
  it.each(["user", "member", "tenant", "host", "primary"])("lookup error %s never grants fallback", async key => {
    if (key === "primary") mocks.host.mockResolvedValue(null)
    mocks[key as keyof typeof mocks].mockRejectedValue(new Error("Unavailable"))
    expect(await hasPermissionServer("match:score")).toBe(false)
    if (key === "host") expect(mocks.primary).not.toHaveBeenCalled()
  })
  it("host context wins over primary membership", async () => {
    expect(await resolveActiveTenantId()).toBe("A")
    expect(mocks.primary).not.toHaveBeenCalled()
  })
  it("uses primary only after a successful absent host result", async () => {
    mocks.host.mockResolvedValue(null)
    expect(await resolveActiveTenantId()).toBe("B")
  })
  it("member resolution returns the host league only for an effective member", async () => {
    expect(await resolveMemberTenantId("clerk-ali")).toBe("A")
  })
  it.each([
    ["no membership", null],
    ["suspended membership", { ...member, status: "suspended" }],
    ["expired membership", { ...member, expiresAt: new Date("2020-01-01T00:00:00Z") }],
    ["platform role", { ...member, role: "super_admin" }],
  ])("member resolution fails closed for %s on a league host", async (_label, membership) => {
    mocks.member.mockResolvedValue(membership)
    expect(await resolveMemberTenantId("clerk-ali")).toBeNull()
  })
  it("member resolution fails closed for a deactivated account and for lookup errors", async () => {
    mocks.user.mockResolvedValue({ ...user, isActive: false })
    expect(await resolveMemberTenantId("clerk-ali")).toBeNull()
    mocks.user.mockRejectedValue(new Error("Unavailable"))
    expect(await resolveMemberTenantId("clerk-ali")).toBeNull()
  })
  it("no league is no authorization, not a global fan/owner grant", async () => {
    mocks.host.mockResolvedValue(null); mocks.primary.mockResolvedValue(null)
    expect(await hasPermissionServer("match:read")).toBe(false)
    expect(mocks.member).not.toHaveBeenCalled()
  })
  it("invite acceptance needs an active account but does not require prior league membership", async () => {
    expect(await hasPermissionServer("invite:accept")).toBe(true)
    expect(mocks.member).not.toHaveBeenCalled()
    expect(mocks.host).not.toHaveBeenCalled()
    mocks.user.mockResolvedValue({ ...user, isActive: false })
    expect(await hasPermissionServer("invite:accept")).toBe(false)
  })
  it("unauthenticated requests cannot resolve/read memberships", async () => {
    mocks.auth.mockResolvedValue({ userId: null })
    expect(await hasPermissionServer("match:read")).toBe(false)
    expect(mocks.host).not.toHaveBeenCalled()
  })
  it("enforcement rejects a suspended owner's mutation despite legacy ownership", async () => {
    mocks.member.mockResolvedValue({ ...member, role: "league_owner", status: "suspended" })
    await expect(requirePermissionServer("settings:manage", "A")).rejects.toThrow("Forbidden")
  })
  it("direct role lookup errors propagate, instead of returning a legacy role", async () => {
    mocks.member.mockRejectedValue(new Error("Schema unavailable"))
    await expect(getUserRoleForTenant("clerk-ali", "A")).rejects.toThrow("Schema unavailable")
  })
})
