import { beforeEach, describe, expect, it, vi } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import { userTenantRoles, auditLogs } from "@mtk/database"
import {
  readLeagueMembers, updateMemberRole, toggleMemberStatus, removeLeagueMember, setMemberExpiry,
} from "@/lib/member-management"

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(), member: vi.fn(), user: vi.fn(), league: vi.fn(), execute: vi.fn(),
  update: vi.fn(), set: vi.fn(), where: vi.fn(), returning: vi.fn(), insert: vi.fn(), values: vi.fn(),
  select: vi.fn(), from: vi.fn(), join: vi.fn(), listWhere: vi.fn(), order: vi.fn(), limit: vi.fn(),
  team: vi.fn(), match: vi.fn(), del: vi.fn(), delWhere: vi.fn(), delReturn: vi.fn(),
}))
vi.mock("@mtk/database", async original => ({ ...await original<typeof import("@mtk/database")>(), db: {
  transaction: mocks.transaction, select: mocks.select,
} }))

const A = "00000000-0000-4000-8000-000000000001"
const B = "00000000-0000-4000-8000-000000000002"
const MEMBER = "00000000-0000-4000-8000-000000000003"
const OWNER = "00000000-0000-4000-8000-000000000004"
const ALI = "00000000-0000-4000-8000-000000000005"
const ctx = { tenantId: A, actorId: OWNER, clerkId: "clerk-owner" }
const actorMember = { id: OWNER, userId: OWNER, tenantId: A, role: "league_owner", status: "active" }
const target = { id: MEMBER, userId: ALI, tenantId: A, role: "scorer", status: "active", version: 2 }
const key = { tenantId: A, membershipId: MEMBER, expectedVersion: 2 }
const dialect = new PgDialect()

beforeEach(() => {
  vi.resetAllMocks()
  mocks.member.mockResolvedValueOnce(target).mockResolvedValueOnce(actorMember).mockResolvedValueOnce(target)
  mocks.user.mockResolvedValueOnce({ id: OWNER, clerkId: "clerk-owner", isActive: true })
    .mockResolvedValueOnce({ id: ALI, role: "player", isActive: true })
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

describe("lib/member-management — league-scoped member reads and writes", () => {
  it("scopes the roster read to the exact league and bounds it", async () => {
    mocks.limit.mockResolvedValue([{ membershipId: MEMBER }])
    expect(await readLeagueMembers(A)).toEqual([{ membershipId: MEMBER }])
    expect(dialect.sqlToQuery(mocks.listWhere.mock.calls[0][0]).params).toEqual([A])
    expect(mocks.order).toHaveBeenCalledTimes(1)
    expect(mocks.limit).toHaveBeenCalledWith(100)
  })

  it("refuses a stale expected workspace before reading any row", async () => {
    await expect(readLeagueMembers(A, B)).rejects.toThrow("Workspace changed")
    expect(mocks.select).not.toHaveBeenCalled()
  })

  it("refuses a cross-league write before opening a transaction", async () => {
    await expect(updateMemberRole({ ...key, tenantId: B, role: "coach" }, ctx)).rejects.toThrow("Workspace changed")
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("locks users, then the league, then memberships — never matches", async () => {
    await toggleMemberStatus({ ...key, status: "suspended" }, ctx)
    const locks = mocks.execute.mock.calls.map(([sql]) => dialect.sqlToQuery(sql))
    expect(locks).toHaveLength(3)
    expect(locks[0].params).toEqual([OWNER, ALI].sort())
    expect(locks[0].sql).toContain("ORDER BY")
    expect(locks[1].params).toEqual([A])
    expect(locks[1].sql).toContain("FOR SHARE")
    expect(locks[2].sql).toContain("FOR UPDATE")
    expect(locks.every((lock) => !lock.sql.includes('"matches"'))).toBe(true)
  })

  it("re-checks the acting owner inside the write transaction", async () => {
    mocks.member.mockReset().mockResolvedValueOnce(target)
      .mockResolvedValueOnce({ ...actorMember, role: "scorer" }).mockResolvedValueOnce(target)
    await expect(toggleMemberStatus({ ...key, status: "suspended" }, ctx)).rejects.toThrow("access changed")
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it("removes the league membership and audits it without touching the account", async () => {
    expect(await removeLeagueMember(key, ctx)).toEqual({ success: true, membershipId: MEMBER })
    expect(mocks.del).toHaveBeenCalledExactlyOnceWith(userTenantRoles)
    expect(mocks.insert).toHaveBeenCalledExactlyOnceWith(auditLogs)
    expect(mocks.values).toHaveBeenCalledWith(expect.objectContaining({ tenantId: A, actorId: OWNER,
      payload: expect.objectContaining({ targetUserId: ALI, after: null }) }))
  })
})

describe("setMemberExpiry — bounded membership access (SCORE-09)", () => {
  const future = new Date(Date.now() + 86_400_000).toISOString()
  const expiryInput = { tenantId: A, membershipId: MEMBER, expectedVersion: 2, expiresAt: future }
  const boundedTarget = { ...target, expiresAt: new Date(Date.now() + 7_200_000) }

  function chain(initial: Record<string, unknown>, actor: Record<string, unknown>, resolved: Record<string, unknown>, account?: Record<string, unknown>) {
    mocks.member.mockReset()
    mocks.member.mockResolvedValueOnce(initial).mockResolvedValueOnce(actor).mockResolvedValueOnce(resolved)
    mocks.user.mockReset()
    mocks.user.mockResolvedValueOnce({ id: OWNER, clerkId: "clerk-owner", isActive: true })
      .mockResolvedValueOnce(account ?? { id: ALI, role: "player", isActive: true })
  }

  it("sets a future expiry, records the acting owner as provenance and audits the change", async () => {
    mocks.returning.mockResolvedValueOnce([{ membershipId: MEMBER, expiresAt: new Date(future), delegatedByUserId: OWNER, version: 3 }])
    expect(await setMemberExpiry(expiryInput, ctx)).toMatchObject({ membershipId: MEMBER, version: 3 })
    expect(mocks.set).toHaveBeenCalledWith(expect.objectContaining({ delegatedByUserId: OWNER }))
    const audit = mocks.values.mock.calls.map(([row]) => row).find(row => row.method === "MEMBERSHIP_EXPIRY_CHANGE")
    expect(audit).toMatchObject({ tenantId: A, actorId: OWNER, actorRole: "league_owner", method: "MEMBERSHIP_EXPIRY_CHANGE",
      payload: { membershipId: MEMBER, targetUserId: ALI, before: { expiresAt: null, version: 2 }, after: future } })
  })

  it("clears a bound explicitly and drops the delegation provenance", async () => {
    chain(boundedTarget, actorMember, boundedTarget)
    mocks.returning.mockResolvedValueOnce([{ membershipId: MEMBER, expiresAt: null, delegatedByUserId: null, version: 3 }])
    expect(await setMemberExpiry({ ...expiryInput, expiresAt: null }, ctx)).toMatchObject({ expiresAt: null })
    expect(mocks.set).toHaveBeenCalledWith(expect.objectContaining({ expiresAt: null, delegatedByUserId: null }))
  })

  it("reports no change without writing when the requested expiry already matches", async () => {
    chain({ ...target, expiresAt: new Date(future) }, actorMember, { ...target, expiresAt: new Date(future) })
    const result = await setMemberExpiry(expiryInput, ctx)
    expect(mocks.update).not.toHaveBeenCalled()
    expect(result).toMatchObject({ membershipId: MEMBER, version: 2 })
  })

  it("rejects a past-dated expiry before opening a transaction (suspend instead)", async () => {
    await expect(setMemberExpiry({ ...expiryInput, expiresAt: "2020-01-01T00:00:00.000Z" }, ctx))
      .rejects.toThrow("must be in the future")
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("refuses a non-owner actor and an owner whose own membership is no longer effective", async () => {
    chain(target, { ...actorMember, role: "scorer" }, target)
    await expect(setMemberExpiry(expiryInput, ctx)).rejects.toThrow("Forbidden")
    chain(target, { ...actorMember, expiresAt: "2020-01-01T00:00:00.000Z" }, target)
    await expect(setMemberExpiry(expiryInput, ctx)).rejects.toThrow("Forbidden")
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it("never bounds owners, self or platform accounts", async () => {
    chain(target, actorMember, target, { id: ALI, role: "super_admin", isActive: true })
    await expect(setMemberExpiry(expiryInput, ctx)).rejects.toThrow("cannot be bounded")
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it("rejects a stale version without writing", async () => {
    chain(target, actorMember, { ...target, version: 3 })
    await expect(setMemberExpiry(expiryInput, ctx)).rejects.toThrow("Member changed")
    expect(mocks.set).not.toHaveBeenCalled()
  })
})
