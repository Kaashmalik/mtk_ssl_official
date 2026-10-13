import { beforeEach, describe, expect, it, vi } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import { userTenantRoles, auditLogs } from "@mtk/database"
import { getUsers, toggleUserStatus, updateUserRole, removeMember } from "@/app/actions/users"

const mocks = vi.hoisted(() => ({ auth: vi.fn(), context: vi.fn(), transaction: vi.fn(),
  member: vi.fn(), user: vi.fn(), league: vi.fn(), execute: vi.fn(),
  update: vi.fn(), set: vi.fn(), where: vi.fn(), returning: vi.fn(), insert: vi.fn(), values: vi.fn(),
  select: vi.fn(), from: vi.fn(), join: vi.fn(), listWhere: vi.fn(), order: vi.fn(), limit: vi.fn(), revalidate: vi.fn(),
  team: vi.fn(), match: vi.fn(), del: vi.fn(), delWhere: vi.fn(), delReturn: vi.fn(),
}))
vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }))
vi.mock("@/lib/dashboard-context", () => ({ getDashboardContext: mocks.context }))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }))
vi.mock("@mtk/database", async original => ({ ...await original<typeof import("@mtk/database")>(), db: {
  transaction: mocks.transaction, select: mocks.select,
} }))
const A = "00000000-0000-4000-8000-000000000001"
const B = "00000000-0000-4000-8000-000000000002"
const MEMBER = "00000000-0000-4000-8000-000000000003"
const OWNER = "00000000-0000-4000-8000-000000000004"
const ALI = "00000000-0000-4000-8000-000000000005"
const target = { id: MEMBER, userId: ALI, tenantId: A, role: "scorer", status: "active", version: 2 }
const actorMember = { id: OWNER, userId: OWNER, tenantId: A, role: "league_owner", status: "active" }
const key = { tenantId: A, membershipId: MEMBER, expectedVersion: 2 }
const dialect = new PgDialect()
beforeEach(() => {
  vi.resetAllMocks()
  mocks.auth.mockResolvedValue({ userId: "clerk-owner" })
  mocks.context.mockResolvedValue({ status: "ready", context: { tenantId: A, actorId: OWNER, role: "league_owner" } })
  mocks.member.mockResolvedValueOnce(target).mockResolvedValueOnce(actorMember).mockResolvedValueOnce(target)
  mocks.user.mockResolvedValueOnce({ id: OWNER, isActive: true }).mockResolvedValueOnce({ id: ALI, role: "player", isActive: true })
  mocks.league.mockResolvedValue({ id: A, ownerId: OWNER, isActive: true })
  mocks.execute.mockResolvedValue([])
  mocks.update.mockReturnValue({ set: mocks.set }); mocks.set.mockReturnValue({ where: mocks.where })
  mocks.where.mockReturnValue({ returning: mocks.returning })
  mocks.returning.mockResolvedValue([{ membershipId: MEMBER, role: "scorer", status: "suspended", version: 3 }])
  mocks.insert.mockReturnValue({ values: mocks.values }); mocks.values.mockResolvedValue(undefined)
  mocks.team.mockResolvedValue(null); mocks.match.mockResolvedValue(null)
  mocks.del.mockReturnValue({ where: mocks.delWhere }); mocks.delWhere.mockReturnValue({ returning: mocks.delReturn })
  mocks.delReturn.mockResolvedValue([{ membershipId: MEMBER, role: "scorer", status: "active", version: 2 }])
  mocks.transaction.mockImplementation(async fn => fn({ execute: mocks.execute,
    query: { userTenantRoles: { findFirst: mocks.member }, users: { findFirst: mocks.user }, tenants: { findFirst: mocks.league },
      teams: { findFirst: mocks.team }, matches: { findFirst: mocks.match } },
    update: mocks.update, insert: mocks.insert, delete: mocks.del,
  }))
  mocks.select.mockReturnValue({ from: mocks.from }); mocks.from.mockReturnValue({ innerJoin: mocks.join })
  mocks.join.mockReturnValue({ where: mocks.listWhere }); mocks.listWhere.mockReturnValue({ orderBy: mocks.order })
  mocks.order.mockReturnValue({ limit: mocks.limit }); mocks.limit.mockResolvedValue([])
})

describe("League-only member administration", () => {
  it("suspends only the exact membership and atomically audits before/after; never updates users", async () => {
    expect(await toggleUserStatus({ ...key, status: "suspended" })).toEqual({ success: true, member: { membershipId: MEMBER, role: "scorer", status: "suspended", version: 3 } })
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith(userTenantRoles)
    expect(mocks.set).toHaveBeenCalledWith({ status: "suspended" })
    expect(dialect.sqlToQuery(mocks.where.mock.calls[0][0]).params).toEqual([MEMBER, A, 2])
    expect(mocks.insert).toHaveBeenCalledExactlyOnceWith(auditLogs)
    expect(mocks.values).toHaveBeenCalledWith(expect.objectContaining({ actorId: OWNER, tenantId: A,
      payload: expect.objectContaining({ targetUserId: ALI, before: { role: "scorer", status: "active", version: 2 }, after: expect.objectContaining({ status: "suspended", version: 3 }) }),
    }))
    expect(mocks.revalidate).toHaveBeenCalledWith("/dashboard", "layout")
  })
  it("updates league role without changing global role/status or assignments", async () => {
    mocks.returning.mockResolvedValue([{ membershipId: MEMBER, role: "coach", status: "active", version: 3 }])
    await updateUserRole({ ...key, role: "coach" })
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith(userTenantRoles)
    expect(mocks.set).toHaveBeenCalledWith({ role: "coach" })
  })
  it("reactivates the league only, even when the platform account stays blocked", async () => {
    mocks.member.mockReset().mockResolvedValueOnce({ ...target, status: "suspended" }).mockResolvedValueOnce(actorMember).mockResolvedValueOnce({ ...target, status: "suspended" })
    mocks.user.mockReset().mockResolvedValueOnce({ id: OWNER, isActive: true }).mockResolvedValueOnce({ id: ALI, role: "player", isActive: false })
    await toggleUserStatus({ ...key, status: "active" })
    expect(mocks.set).toHaveBeenCalledWith({ status: "active" })
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith(userTenantRoles)
  })
  it("locks users in order, then league, then memberships without locking matches", async () => {
    await toggleUserStatus({ ...key, status: "suspended" })
    const locks = mocks.execute.mock.calls.map(([sql]) => dialect.sqlToQuery(sql))
    expect(locks).toHaveLength(3)
    expect(locks[0].params).toEqual([OWNER, ALI].sort())
    expect(locks[0].sql).toContain("ORDER BY")
    expect(locks[1].params).toEqual([A])
    expect(locks[1].sql).toContain("FOR SHARE")
    expect(locks[2].params).toEqual([A, ...[OWNER, ALI].sort()])
    expect(locks[2].sql).toContain("FOR UPDATE")
    expect(locks.every(lock => !lock.sql.includes('"matches"'))).toBe(true)
  })
  it("rejects stale workspace input before opening a transaction", async () => {
    await expect(toggleUserStatus({ ...key, tenantId: B, status: "suspended" })).rejects.toThrow("Workspace changed")
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
  it.each(["super_admin", "league_owner", "not-a-role", null])("rejects privileged/invalid role grant %s", async role => {
    await expect(updateUserRole({ ...key, role } as never)).rejects.toThrow()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
  it.each([-1, 1.5, NaN, undefined])("rejects invalid/missing expected version %s", async expectedVersion => {
    await expect(toggleUserStatus({ ...key, expectedVersion, status: "suspended" } as never)).rejects.toThrow()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
  it.each(["team_manager", "scorer", "fan", "super_admin"])("denies private membership listing/management to %s", async role => {
    mocks.context.mockResolvedValue({ status: "ready", context: { role, tenantId: A, actorId: OWNER } })
    await expect(getUsers()).rejects.toThrow("Forbidden")
    await expect(toggleUserStatus({ ...key, status: "suspended" })).rejects.toThrow("Forbidden")
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.select).not.toHaveBeenCalled()
  })
  it.each(["denied", "unavailable", "no-tenant"])("denies context %s", async status => {
    mocks.context.mockResolvedValue({ status })
    await expect(getUsers()).rejects.toThrow("Forbidden")
    expect(mocks.select).not.toHaveBeenCalled()
  })
  it("requires a current authenticated session", async () => {
    mocks.auth.mockResolvedValue({ userId: null })
    await expect(getUsers()).rejects.toThrow("Unauthorized")
    expect(mocks.context).not.toHaveBeenCalled()
  })
  it.each([undefined, { ...target, tenantId: B }, { ...target, id: B }])("rejects foreign/missing membership %s", async member => {
    mocks.member.mockReset().mockResolvedValue(member)
    await expect(toggleUserStatus({ ...key, status: "suspended" })).rejects.toThrow("Member not found")
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it.each([{ role: "league_owner" }, { role: "super_admin" }, { userId: OWNER }])("protects owner/self/platform membership %s", async changes => {
    const protectedMember = { ...target, ...changes }
    mocks.member.mockReset().mockResolvedValueOnce(protectedMember).mockResolvedValueOnce(actorMember).mockResolvedValueOnce(protectedMember)
    mocks.user.mockReset().mockResolvedValueOnce({ id: OWNER, isActive: true }).mockResolvedValueOnce({ id: protectedMember.userId, role: "player" })
    await expect(toggleUserStatus({ ...key, status: "suspended" })).rejects.toThrow("cannot be changed")
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it("protects the recorded league owner even if a corrupted junction role is lower", async () => {
    mocks.league.mockResolvedValue({ id: A, isActive: true, ownerId: ALI })
    await expect(updateUserRole({ ...key, role: "fan" })).rejects.toThrow("cannot be changed")
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it("protects a platform administrator even if their league role is ordinary", async () => {
    mocks.user.mockReset().mockResolvedValueOnce({ id: OWNER, isActive: true }).mockResolvedValueOnce({ id: ALI, role: "super_admin" })
    await expect(updateUserRole({ ...key, role: "fan" })).rejects.toThrow("cannot be changed")
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it.each([{ status: "suspended" }, { role: "scorer" }, { tenantId: B }, { userId: ALI }])("rechecks actor membership after locks %s", async changes => {
    mocks.member.mockReset().mockResolvedValueOnce(target).mockResolvedValueOnce({ ...actorMember, ...changes })
    await expect(toggleUserStatus({ ...key, status: "suspended" })).rejects.toThrow("access changed")
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it("rechecks account activation after acquiring locks", async () => {
    mocks.user.mockReset().mockResolvedValue({ id: OWNER, isActive: false })
    await expect(toggleUserStatus({ ...key, status: "suspended" })).rejects.toThrow("access changed")
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it.each([{ isActive: false, id: A }, { isActive: true, id: B }, undefined])("rechecks league availability %s", async league => {
    mocks.league.mockResolvedValue(league)
    await expect(toggleUserStatus({ ...key, status: "suspended" })).rejects.toThrow("access changed")
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it("rejects stale expected version rather than overwrite the later administrator", async () => {
    await expect(toggleUserStatus({ ...key, expectedVersion: 1, status: "suspended" })).rejects.toThrow("Member changed")
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it("rejects a lost conditional update without audit or UI success", async () => {
    mocks.returning.mockResolvedValue([])
    await expect(toggleUserStatus({ ...key, status: "suspended" })).rejects.toThrow("Member changed")
    expect(mocks.insert).not.toHaveBeenCalled()
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
  it("fails the transaction if the audit cannot be written", async () => {
    mocks.values.mockRejectedValue(new Error("Audit unavailable"))
    await expect(toggleUserStatus({ ...key, status: "suspended" })).rejects.toThrow("Audit unavailable")
    expect(mocks.revalidate).not.toHaveBeenCalled()
    // Actual rollback/locking remains a real PostgreSQL staging gate.
  })
  it("does not rewrite/version/audit an unchanged command", async () => {
    expect(await toggleUserStatus({ ...key, status: "active" })).toMatchObject({ success: true, member: { status: "active", version: 2 } })
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.insert).not.toHaveBeenCalled()
  })
  it("lists explicit memberships in the authorized league with a bounded field allowlist", async () => {
    await getUsers()
    expect(mocks.from).toHaveBeenCalledWith(userTenantRoles)
    expect(dialect.sqlToQuery(mocks.listWhere.mock.calls[0][0]).params).toEqual([A])
    expect(mocks.limit).toHaveBeenCalledWith(100)
    expect(Object.keys(mocks.select.mock.calls[0][0])).not.toContain("tenantIds")
    expect(Object.keys(mocks.select.mock.calls[0][0])).not.toContain("clerkId")
  })
  it("rejects a stale league assertion on the list rather than returning another league", async () => {
    await expect(getUsers(B)).rejects.toThrow("Workspace changed")
    expect(mocks.select).not.toHaveBeenCalled()
  })
})

describe("League membership removal", () => {
  const removeKey = { tenantId: A, membershipId: MEMBER, expectedVersion: 2 }
  it("removes only the exact league membership with an atomic before/after audit; never deletes the account", async () => {
    expect(await removeMember(removeKey)).toEqual({ success: true, membershipId: MEMBER })
    expect(mocks.del).toHaveBeenCalledExactlyOnceWith(userTenantRoles)
    expect(dialect.sqlToQuery(mocks.delWhere.mock.calls[0][0]).params).toEqual([MEMBER, A, 2])
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.insert).toHaveBeenCalledExactlyOnceWith(auditLogs)
    expect(mocks.values).toHaveBeenCalledWith(expect.objectContaining({ method: "MEMBERSHIP_REMOVE", actorId: OWNER, tenantId: A,
      payload: expect.objectContaining({ targetUserId: ALI, before: { role: "scorer", status: "active", version: 2 }, after: null }) }))
    expect(mocks.revalidate).toHaveBeenCalledWith("/dashboard", "layout")
  })
  it("scopes team and scorer assignment checks to the active league", async () => {
    await removeMember(removeKey)
    expect(dialect.sqlToQuery(mocks.team.mock.calls[0][0].where).params).toEqual([A, ALI])
    expect(dialect.sqlToQuery(mocks.match.mock.calls[0][0].where).params).toEqual([A, ALI])
  })
  it("refuses removal while the member manages a team in this league", async () => {
    mocks.team.mockResolvedValue({ id: B, tenantId: A, managerId: ALI })
    await expect(removeMember(removeKey)).rejects.toThrow("manages a team")
    expect(mocks.del).not.toHaveBeenCalled()
    expect(mocks.insert).not.toHaveBeenCalled()
  })
  it("refuses removal while the member is an assigned scorer", async () => {
    mocks.match.mockResolvedValue({ id: B, tenantId: A, scorerId: ALI })
    await expect(removeMember(removeKey)).rejects.toThrow("assigned scorer")
    expect(mocks.del).not.toHaveBeenCalled()
  })
  it.each([{ userId: OWNER }, { role: "league_owner" }, { role: "super_admin" }])("protects owner/self/platform membership from removal %s", async changes => {
    const protectedMember = { ...target, ...changes }
    mocks.member.mockReset().mockResolvedValueOnce(protectedMember).mockResolvedValueOnce(actorMember).mockResolvedValueOnce(protectedMember)
    mocks.user.mockReset().mockResolvedValueOnce({ id: OWNER, isActive: true }).mockResolvedValueOnce({ id: protectedMember.userId, role: "player" })
    await expect(removeMember(removeKey)).rejects.toThrow("cannot be removed")
    expect(mocks.del).not.toHaveBeenCalled()
  })
  it("protects a platform administrator whose league role is ordinary", async () => {
    mocks.user.mockReset().mockResolvedValueOnce({ id: OWNER, isActive: true }).mockResolvedValueOnce({ id: ALI, role: "super_admin" })
    await expect(removeMember(removeKey)).rejects.toThrow("cannot be removed")
    expect(mocks.del).not.toHaveBeenCalled()
  })
  it("rechecks actor owner membership after acquiring locks", async () => {
    mocks.member.mockReset().mockResolvedValueOnce(target).mockResolvedValueOnce({ ...actorMember, status: "suspended" })
    await expect(removeMember(removeKey)).rejects.toThrow("access changed")
    expect(mocks.del).not.toHaveBeenCalled()
  })
  it.each([undefined, { ...target, tenantId: B }, { ...target, id: B }])("rejects foreign/missing membership %s", async member => {
    mocks.member.mockReset().mockResolvedValue(member)
    await expect(removeMember(removeKey)).rejects.toThrow("Member not found")
    expect(mocks.del).not.toHaveBeenCalled()
  })
  it("rejects a stale version instead of deleting the later membership", async () => {
    await expect(removeMember({ ...removeKey, expectedVersion: 1 })).rejects.toThrow("Member changed")
    expect(mocks.del).not.toHaveBeenCalled()
  })
  it("rejects a lost conditional delete without audit or success", async () => {
    mocks.delReturn.mockResolvedValue([])
    await expect(removeMember(removeKey)).rejects.toThrow("Member changed")
    expect(mocks.insert).not.toHaveBeenCalled()
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
  it("rejects a stale workspace before opening a transaction", async () => {
    await expect(removeMember({ ...removeKey, tenantId: B })).rejects.toThrow("Workspace changed")
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
  it.each(["scorer", "team_manager", "fan", "super_admin"])("denies removal to context role %s", async role => {
    mocks.context.mockResolvedValue({ status: "ready", context: { role, tenantId: A, actorId: OWNER } })
    await expect(removeMember(removeKey)).rejects.toThrow("Forbidden")
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
  it.each([{ membershipId: "not-a-uuid" }, { expectedVersion: -1 }, { expectedVersion: 1.5 }])("rejects invalid removal input %s", async change => {
    await expect(removeMember({ ...removeKey, ...change } as never)).rejects.toThrow()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
})
