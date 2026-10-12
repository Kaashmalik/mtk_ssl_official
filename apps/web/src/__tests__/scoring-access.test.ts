import { beforeEach, describe, expect, it, vi } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import { requireMatchScoringAccess, requireScoringActorId } from "@/lib/scoring-access"
import { scorerMembership } from "@/lib/scorer-membership"

const mocks = vi.hoisted(() => ({ permission: vi.fn(), role: vi.fn(), match: vi.fn(), user: vi.fn() }))
vi.mock("@/lib/rbac-server", () => ({ requirePermissionServer: mocks.permission, getUserRoleForTenant: mocks.role }))
vi.mock("@mtk/database", async (importOriginal) => ({
  ...await importOriginal<typeof import("@mtk/database")>(),
  db: { query: { matches: { findFirst: mocks.match }, users: { findFirst: mocks.user } } },
}))

describe("Match-scoped scorer authorization", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.permission.mockResolvedValue(undefined)
    mocks.role.mockResolvedValue("scorer")
    mocks.match.mockResolvedValue({ id: "match", tenantId: "tenant", scorerId: "db-user" })
    mocks.user.mockResolvedValue({ id: "db-user", isActive: true })
  })

  it("uses the tenant-filtered match and database UUID, not the Clerk ID", async () => {
    await requireMatchScoringAccess("clerk-user", "tenant", "match")
    expect(mocks.permission).toHaveBeenCalledWith("match:score", "tenant")
    expect(mocks.role).toHaveBeenCalledWith("clerk-user", "tenant")
    const query = new PgDialect().sqlToQuery(mocks.match.mock.calls[0][0].where)
    expect(query.params).toEqual(["match", "tenant"])
  })

  it.each([null, "other-user", "clerk-user"])("rejects a scorer assigned as %s", async (scorerId) => {
    mocks.match.mockResolvedValue({ tenantId: "tenant", scorerId })
    await expect(requireMatchScoringAccess("clerk-user", "tenant", "match")).rejects.toThrow("assigned scorer")
  })

  it.each(["league_owner"])("allows %s oversight only after exact-tenant permission", async (role) => {
    mocks.role.mockResolvedValue(role)
    await requireMatchScoringAccess("clerk-user", "tenant", "match")
    expect(mocks.permission).toHaveBeenCalledWith("match:score", "tenant")
    expect(mocks.user).toHaveBeenCalledOnce()
  })

  it.each([null, "coach", "fan", "super_admin"])("fails closed for role %s", async (role) => {
    mocks.role.mockResolvedValue(role)
    await expect(requireMatchScoringAccess("clerk-user", "tenant", "match")).rejects.toThrow("Forbidden")
  })

  it("does not allow a missing/unprovisioned user", async () => {
    mocks.user.mockResolvedValue(undefined)
    await expect(requireMatchScoringAccess("clerk-user", "tenant", "match")).rejects.toThrow("assigned scorer")
  })

  it.each(["scorer", "league_owner", "super_admin"])("rejects an inactive %s account", async (role) => {
    mocks.role.mockResolvedValue(role)
    mocks.user.mockResolvedValue({ id: "db-user", isActive: false })
    await expect(requireMatchScoringAccess("clerk-user", "tenant", "match")).rejects.toThrow("Forbidden")
  })

  it("resolves the actor UUID from the authenticated Clerk account", async () => {
    const actorId = "00000000-0000-7000-8000-000000000006"
    mocks.user.mockResolvedValue({ id: actorId, isActive: true })
    expect(await requireScoringActorId("clerk-user")).toBe(actorId)
    const query = new PgDialect().sqlToQuery(mocks.user.mock.calls[0][0].where)
    expect(query.params).toEqual(["clerk-user"])
  })

  it.each([undefined, { id: "clerk-user", isActive: true },
    { id: "00000000-0000-4000-8000-000000000006", isActive: false }])("fails closed for unavailable actor %s", async (user) => {
    mocks.user.mockResolvedValue(user)
    await expect(requireScoringActorId("clerk-user")).rejects.toThrow("unavailable or inactive")
  })

  it("fails closed for a cross-tenant match even if returned by the adapter", async () => {
    mocks.match.mockResolvedValue({ tenantId: "other-tenant" })
    await expect(requireMatchScoringAccess("clerk-user", "tenant", "match")).rejects.toThrow("Match not found")
  })

  it("does not query a match if the tenant permission is denied", async () => {
    mocks.permission.mockRejectedValue(new Error("Forbidden"))
    await expect(requireMatchScoringAccess("clerk-user", "tenant", "match")).rejects.toThrow("Forbidden")
    expect(mocks.match).not.toHaveBeenCalled()
  })

  it("scopes scorer candidates to active explicit membership without legacy fallback", () => {
    const query = new PgDialect().sqlToQuery(scorerMembership("active-tenant"))
    expect(query.sql).toContain('"status" = \'active\'')
    expect(query.sql).not.toContain("ANY")
    expect(query.params).toEqual(["active-tenant"])
  })
})
