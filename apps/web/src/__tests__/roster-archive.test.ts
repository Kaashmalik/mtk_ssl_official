import { beforeEach, describe, expect, it, vi } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import { teams, players, auditLogs } from "@mtk/database"
import { deleteTeam } from "@/app/actions/teams"
import { deletePlayer } from "@/app/actions/players"

const mocks = vi.hoisted(() => ({ auth: vi.fn(), tenant: vi.fn(), permission: vi.fn(), fallback: vi.fn(),
  transaction: vi.fn(), execute: vi.fn(), user: vi.fn(), league: vi.fn(), member: vi.fn(), team: vi.fn(), player: vi.fn(),
  match: vi.fn(), update: vi.fn(), set: vi.fn(), where: vi.fn(), returning: vi.fn(), insert: vi.fn(), values: vi.fn(),
  directDelete: vi.fn(), repoDelete: vi.fn(), revalidate: vi.fn() }))
vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }))
vi.mock("@/lib/rbac-server", () => ({ resolveActiveTenantId: mocks.tenant, requirePermissionServer: mocks.permission }))
vi.mock("@/app/actions/tenants", () => ({ getMyTenant: mocks.fallback }))
vi.mock("@mtk/database", async original => ({ ...await original<typeof import("@mtk/database")>(),
  teamRepo: { deleteById: mocks.repoDelete }, playerRepo: { deleteById: mocks.repoDelete },
  db: { transaction: mocks.transaction, delete: mocks.directDelete },
}))
const TENANT = "00000000-0000-4000-8000-000000000001"
const ACTOR = "00000000-0000-4000-8000-000000000002"
const TEAM = "00000000-0000-4000-8000-000000000003"
const PLAYER = "00000000-0000-4000-8000-000000000004"
const OTHER = "00000000-0000-4000-8000-000000000005"
const dialect = new PgDialect()
const actor = { id: ACTOR, clerkId: "clerk", isActive: true }
const member = { userId: ACTOR, tenantId: TENANT, role: "league_owner", status: "active" }
const team = { id: TEAM, tenantId: TENANT, isActive: true }
const player = { id: PLAYER, tenantId: TENANT, teamId: TEAM, isActive: true, status: "active" }
beforeEach(() => {
  vi.resetAllMocks()
  mocks.auth.mockResolvedValue({ userId: "clerk" })
  mocks.tenant.mockResolvedValue(TENANT)
  mocks.permission.mockResolvedValue(undefined)
  mocks.fallback.mockImplementation(() => { throw new Error("Do not use owned/default league") })
  mocks.user.mockResolvedValue(actor)
  mocks.league.mockResolvedValue({ id: TENANT, isActive: true })
  mocks.member.mockResolvedValue(member)
  mocks.team.mockResolvedValue(team)
  mocks.player.mockResolvedValue(player)
  mocks.match.mockResolvedValue(undefined)
  mocks.execute.mockResolvedValue([])
  mocks.update.mockReturnValue({ set: mocks.set })
  mocks.set.mockReturnValue({ where: mocks.where })
  mocks.where.mockReturnValue({ returning: mocks.returning })
  mocks.returning.mockImplementation(async () => [{ ...(mocks.update.mock.calls[0][0] === teams ? team : player),
    ...mocks.set.mock.calls[0][0] }])
  mocks.insert.mockReturnValue({ values: mocks.values })
  mocks.values.mockResolvedValue(undefined)
  mocks.transaction.mockImplementation(async fn => fn({ execute: mocks.execute, update: mocks.update, insert: mocks.insert,
    query: { users: { findFirst: mocks.user }, tenants: { findFirst: mocks.league }, userTenantRoles: { findFirst: mocks.member },
      teams: { findFirst: mocks.team }, players: { findFirst: mocks.player }, matches: { findFirst: mocks.match } },
  }))
})
function noDeletes() {
  expect(mocks.directDelete).not.toHaveBeenCalled()
  expect(mocks.repoDelete).not.toHaveBeenCalled()
}
function noWrites() {
  noDeletes()
  expect(mocks.update).not.toHaveBeenCalled()
  expect(mocks.insert).not.toHaveBeenCalled()
  expect(mocks.revalidate).not.toHaveBeenCalled()
}

describe.each(["team", "player"] as const)("History-preserving %s archive", kind => {
  const id = kind === "team" ? TEAM : PLAYER
  const run = () => kind === "team" ? deleteTeam(id) : deletePlayer(id)
  it("uses exact active league, updates only archive flags and audits before cache invalidation", async () => {
    await expect(run()).resolves.toEqual({ success: true, archived: true })
    expect(mocks.fallback).not.toHaveBeenCalled()
    expect(mocks.permission).toHaveBeenCalledWith(`${kind}:delete`, TENANT)
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "read committed" })
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith(kind === "team" ? teams : players)
    expect(mocks.set).toHaveBeenCalledWith(kind === "team" ? { isActive: false, updatedAt: expect.any(Date) }
      : { isActive: false, status: "inactive", updatedAt: expect.any(Date) })
    expect(dialect.sqlToQuery(mocks.where.mock.calls[0][0]).params).toEqual([id, TENANT])
    expect(mocks.insert).toHaveBeenCalledExactlyOnceWith(auditLogs)
    expect(mocks.values).toHaveBeenCalledWith(expect.objectContaining({ tenantId: TENANT, actorId: ACTOR,
      actorRole: "league_owner", method: `${kind.toUpperCase()}_ARCHIVE`, payload: { resourceId: id,
        before: kind === "team" ? { isActive: true } : { isActive: true, status: "active" },
        after: kind === "team" ? { isActive: false } : { isActive: false, status: "inactive" } } }))
    expect(mocks.revalidate.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.values.mock.invocationCallOrder[0])
    noDeletes()
  })
  it("locks account -> league -> membership -> team -> player (when present), never matches", async () => {
    await run()
    const locks = mocks.execute.mock.calls.map(([query]) => dialect.sqlToQuery(query))
    expect(locks.map(query => query.params)).toEqual([[ACTOR], [TENANT], [ACTOR, TENANT], [TEAM, TENANT],
      ...(kind === "player" ? [[PLAYER, TENANT]] : [])])
    expect(locks.every(query => !query.sql.includes('"matches"'))).toBe(true)
    expect(locks.slice(3).every(query => query.sql.includes("FOR UPDATE"))).toBe(true)
    expect(mocks.user.mock.invocationCallOrder[1]).toBeGreaterThan(mocks.execute.mock.invocationCallOrder[2])
    expect(mocks.member.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.execute.mock.invocationCallOrder[2])
    expect(mocks.match.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.execute.mock.invocationCallOrder.at(-1)!)
    const fixtureRead = dialect.sqlToQuery(mocks.match.mock.calls[0][0].where)
    expect(fixtureRead.params).toEqual([TENANT, TEAM, TEAM, "scheduled", "toss", "live", "innings_break"])
    expect(fixtureRead.sql).not.toMatch(/FOR (UPDATE|SHARE)/)
    expect(mocks.match.mock.calls[0][0].columns).toEqual({ id: true })
  })
  it.each([null, { id: OTHER }, { clerkId: "remapped" }, { clerkId: null }, { isActive: false }])("rechecks locked account %s", async change => {
    mocks.user.mockReset().mockResolvedValueOnce(actor).mockResolvedValueOnce(change === null ? null : { ...actor, ...change })
    await expect(run()).rejects.toThrow("access changed")
    noWrites()
  })
  it.each([null, { status: "suspended" }, { status: "pending" }, { userId: OTHER }, { tenantId: OTHER },
    ...["super_admin", "team_manager", "coach", "scorer", "player", "fan"].map(role => ({ role }))])("rechecks exact active owner membership %s", async change => {
    mocks.member.mockResolvedValue(change === null ? null : { ...member, ...change })
    await expect(run()).rejects.toThrow("access changed")
    noWrites()
  })
  it.each([null, { id: TENANT, isActive: false }, { id: OTHER, isActive: true }])("rejects unavailable league %s", async league => {
    mocks.league.mockResolvedValue(league)
    await expect(run()).rejects.toThrow("access changed")
    noWrites()
  })
  it("rejects an unprovisioned actor", async () => {
    mocks.user.mockResolvedValue(null)
    await expect(run()).rejects.toThrow("account not found")
    noWrites()
  })
  it("rejects anonymous sessions before SQL", async () => {
    mocks.auth.mockResolvedValue({ userId: null })
    await expect(run()).rejects.toThrow("Unauthorized")
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
  it("rejects an absent active league without switching workspaces", async () => {
    mocks.tenant.mockResolvedValue(null)
    await expect(run()).rejects.toThrow("Tenant not found")
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
  it("propagates active league resolution failure", async () => {
    mocks.tenant.mockRejectedValue(new Error("Resolution unavailable"))
    await expect(run()).rejects.toThrow("Resolution unavailable")
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.fallback).not.toHaveBeenCalled()
  })
  it("requires explicit tenant permission before SQL", async () => {
    mocks.permission.mockImplementation(async (_permission, tenantId) => { if (tenantId) throw new Error("Forbidden") })
    await expect(run()).rejects.toThrow("Forbidden")
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
  it("refuses unfinished fixtures without deleting any existing history", async () => {
    mocks.match.mockResolvedValue({ id: OTHER })
    await expect(run()).rejects.toThrow("unfinished fixtures")
    noWrites()
  })
  it("checks fixtures after a simulated resource-lock wait returns", async () => {
    mocks.execute.mockImplementation(async query => {
      if (dialect.sqlToQuery(query).sql.includes('FROM "teams"')) mocks.match.mockResolvedValue({ id: OTHER })
      return []
    })
    await expect(run()).rejects.toThrow("unfinished fixtures")
    noWrites()
    // A call-order double, NOT a PostgreSQL two-session locking test.
  })
  it.each([null, { ...team, id: OTHER }, { ...team, tenantId: OTHER }])("refuses foreign/missing resource teams %s", async current => {
    mocks.team.mockResolvedValue(current)
    await expect(run()).rejects.toThrow("Team not found")
    noWrites()
  })
  it("fails a lost write before auditing or cache invalidation", async () => {
    mocks.returning.mockResolvedValue([])
    await expect(run()).rejects.toThrow("changed")
    expect(mocks.insert).not.toHaveBeenCalled()
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
  it("propagates audit failure without false success", async () => {
    mocks.values.mockRejectedValue(new Error("Audit unavailable"))
    await expect(run()).rejects.toThrow("Audit unavailable")
    expect(mocks.revalidate).not.toHaveBeenCalled()
    noDeletes()
    // Transaction double does not model or certify PostgreSQL rollback.
  })
  it("reauthorizes an already archived retry without rewriting timestamps or auditing twice", async () => {
    if (kind === "team") mocks.team.mockResolvedValue({ ...team, isActive: false })
    else mocks.player.mockResolvedValue({ ...player, isActive: false, status: "inactive" })
    await expect(run()).resolves.toMatchObject({ success: true })
    expect(mocks.member).toHaveBeenCalledOnce()
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.insert).not.toHaveBeenCalled()
  })
  it("does not use an archived retry to bypass current authority", async () => {
    mocks.team.mockResolvedValue({ ...team, isActive: false })
    mocks.player.mockResolvedValue({ ...player, isActive: false, status: "inactive" })
    mocks.member.mockResolvedValue({ ...member, status: "suspended" })
    await expect(run()).rejects.toThrow("access changed")
    noWrites()
  })
  it("rejects malformed IDs before SQL", async () => {
    await expect(kind === "team" ? deleteTeam("bad") : deletePlayer("bad")).rejects.toThrow()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
})

describe("Player archival team drift and identity preservation", () => {
  it.each([null, { ...player, id: OTHER }, { ...player, tenantId: OTHER }])("rejects unavailable player before resource locks %s", async current => {
    mocks.player.mockResolvedValue(current)
    await expect(deletePlayer(PLAYER)).rejects.toThrow("Player not found")
    expect(mocks.execute).toHaveBeenCalledTimes(3)
    noWrites()
  })
  it.each([null, { ...player, id: OTHER }, { ...player, tenantId: OTHER }])("rechecks player after its lock %s", async current => {
    mocks.player.mockReset().mockResolvedValueOnce(player).mockResolvedValueOnce(current)
    await expect(deletePlayer(PLAYER)).rejects.toThrow("Player not found")
    noWrites()
  })
  it.each([OTHER, null])("rejects a changed team link without chasing another team lock %s", async teamId => {
    mocks.player.mockReset().mockResolvedValueOnce(player).mockResolvedValueOnce({ ...player, teamId })
    await expect(deletePlayer(PLAYER)).rejects.toThrow("Player team changed")
    expect(mocks.execute).toHaveBeenCalledTimes(5)
    noWrites()
  })
  it("archives an unassigned player without global identity or team mutation", async () => {
    mocks.player.mockResolvedValue({ ...player, teamId: null })
    await deletePlayer(PLAYER)
    expect(mocks.execute).toHaveBeenCalledTimes(4)
    expect(mocks.team).not.toHaveBeenCalled()
    expect(mocks.match).not.toHaveBeenCalled()
    expect(mocks.set.mock.calls[0][0]).not.toHaveProperty("userId")
    expect(mocks.set.mock.calls[0][0]).not.toHaveProperty("profileId")
    expect(mocks.set.mock.calls[0][0]).not.toHaveProperty("teamId")
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith(players)
  })
  it("rejects an unassigned-to-assigned drift without acquiring a team lock after the player", async () => {
    mocks.player.mockReset().mockResolvedValueOnce({ ...player, teamId: null }).mockResolvedValueOnce(player)
    await expect(deletePlayer(PLAYER)).rejects.toThrow("Player team changed")
    expect(mocks.execute).toHaveBeenCalledTimes(4)
    expect(mocks.team).not.toHaveBeenCalled()
    noWrites()
  })
})
