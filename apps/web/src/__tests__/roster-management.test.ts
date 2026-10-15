import { beforeEach, describe, expect, it, vi } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import { teams, players, auditLogs } from "@mtk/database"
import { createTeam, updateTeam, addPlayerToTeam, removePlayerFromTeam } from "@/app/actions/teams"
import { createPlayer, updatePlayer } from "@/app/actions/players"

const mocks = vi.hoisted(() => ({ auth: vi.fn(), permission: vi.fn(), tenant: vi.fn(), fallback: vi.fn(),
  transaction: vi.fn(), execute: vi.fn(), user: vi.fn(), league: vi.fn(), member: vi.fn(), team: vi.fn(), player: vi.fn(), tournament: vi.fn(),
  match: vi.fn(), select: vi.fn(), from: vi.fn(), countWhere: vi.fn(), insert: vi.fn(), values: vi.fn(), returningInsert: vi.fn(),
  update: vi.fn(), set: vi.fn(), where: vi.fn(), returning: vi.fn(), plan: vi.fn(), revalidate: vi.fn(), repoWrite: vi.fn() }))
vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }))
vi.mock("@/lib/rbac-server", () => ({ requirePermissionServer: mocks.permission, resolveActiveTenantId: mocks.tenant }))
vi.mock("@/app/actions/tenants", () => ({ getMyTenant: mocks.fallback }))
vi.mock("@mtk/database", async original => ({ ...await original<typeof import("@mtk/database")>(),
  checkPlanLimit: mocks.plan, teamRepo: { insertOne: mocks.repoWrite, updateById: mocks.repoWrite },
  playerRepo: { insertOne: mocks.repoWrite, updateById: mocks.repoWrite }, db: { transaction: mocks.transaction },
}))
const TENANT = "00000000-0000-4000-8000-000000000001"
const ACTOR = "00000000-0000-4000-8000-000000000002"
const TEAM = "00000000-0000-4000-8000-000000000003"
const PLAYER = "00000000-0000-4000-8000-000000000004"
const OTHER = "00000000-0000-4000-8000-000000000005"
const TOURNAMENT = "00000000-0000-4000-8000-000000000006"
const actor = { id: ACTOR, clerkId: "clerk", isActive: true }
const member = { userId: ACTOR, tenantId: TENANT, role: "league_owner", status: "active" }
const team = { id: TEAM, tenantId: TENANT, name: "Team", slug: "team", isActive: true,
  managerId: ACTOR, captainId: null, maxSquadSize: 15, tournamentId: null }
const player = { id: PLAYER, tenantId: TENANT, teamId: null, name: "Player", status: "active", isActive: true }
const dialect = new PgDialect()
const operations = ["TEAM_CREATE", "TEAM_UPDATE", "PLAYER_CREATE", "PLAYER_UPDATE", "ROSTER_ADD", "ROSTER_REMOVE"] as const
type Operation = typeof operations[number]
function run(operation: Operation) {
  switch (operation) {
    case "TEAM_CREATE": return createTeam({ name: "Team" })
    case "TEAM_UPDATE": return updateTeam(TEAM, { city: "City" })
    case "PLAYER_CREATE": return createPlayer({ name: "Player", teamId: TEAM })
    case "PLAYER_UPDATE": return updatePlayer(PLAYER, { teamId: TEAM })
    case "ROSTER_ADD": return addPlayerToTeam(TEAM, PLAYER)
    case "ROSTER_REMOVE": return removePlayerFromTeam(TEAM, PLAYER)
  }
}
beforeEach(() => {
  vi.resetAllMocks()
  mocks.auth.mockResolvedValue({ userId: "clerk" })
  mocks.tenant.mockResolvedValue(TENANT)
  mocks.permission.mockResolvedValue(undefined)
  mocks.fallback.mockImplementation(() => { throw new Error("Never use fallback league") })
  mocks.execute.mockResolvedValue([])
  mocks.user.mockResolvedValue(actor)
  mocks.league.mockResolvedValue({ id: TENANT, isActive: true, plan: "pro" })
  mocks.member.mockResolvedValue(member)
  mocks.team.mockImplementation(async ({ where }) => ({ ...team, id: dialect.sqlToQuery(where).params[0] }))
  mocks.player.mockResolvedValue(player)
  mocks.tournament.mockResolvedValue({ id: TOURNAMENT, tenantId: TENANT, status: "live" })
  mocks.match.mockResolvedValue(undefined)
  mocks.select.mockReturnValue({ from: mocks.from })
  mocks.from.mockReturnValue({ where: mocks.countWhere })
  mocks.countWhere.mockResolvedValue([{ total: 0 }])
  mocks.insert.mockReturnValue({ values: mocks.values })
  mocks.values.mockReturnValue({ returning: mocks.returningInsert })
  mocks.returningInsert.mockImplementation(async () => [{ ...(mocks.insert.mock.calls[0][0] === teams ? team : player),
    ...mocks.values.mock.calls[0][0] }])
  mocks.update.mockReturnValue({ set: mocks.set })
  mocks.set.mockReturnValue({ where: mocks.where })
  mocks.where.mockReturnValue({ returning: mocks.returning })
  mocks.returning.mockImplementation(async () => [{ ...(mocks.update.mock.calls[0][0] === teams ? team : player), ...mocks.set.mock.calls[0][0] }])
  mocks.transaction.mockImplementation(async fn => fn({ execute: mocks.execute, select: mocks.select,
    insert: mocks.insert, update: mocks.update, query: { users: { findFirst: mocks.user }, tenants: { findFirst: mocks.league },
      userTenantRoles: { findFirst: mocks.member }, teams: { findFirst: mocks.team }, players: { findFirst: mocks.player },
      tournaments: { findFirst: mocks.tournament }, matches: { findFirst: mocks.match } },
  }))
})
function noWrites() {
  expect(mocks.update).not.toHaveBeenCalled()
  expect(mocks.insert).not.toHaveBeenCalled()
  expect(mocks.repoWrite).not.toHaveBeenCalled()
  expect(mocks.revalidate).not.toHaveBeenCalled()
}

describe.each(operations)("Current %s mutation authority", operation => {
  beforeEach(() => { if (operation === "ROSTER_REMOVE") mocks.player.mockResolvedValue({ ...player, teamId: TEAM }) })
  it("writes/audits in one transaction using current league/account/membership", async () => {
    await expect(run(operation)).resolves.toMatchObject({ success: true })
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "read committed" })
    expect(mocks.fallback).not.toHaveBeenCalled()
    expect(mocks.repoWrite).not.toHaveBeenCalled()
    const permission = operation === "TEAM_CREATE" ? "team:create" : operation === "TEAM_UPDATE" ? "team:update"
      : operation === "PLAYER_CREATE" ? "player:create" : operation === "PLAYER_UPDATE" ? "player:update" : "team:manage_roster"
    expect(mocks.permission).toHaveBeenCalledWith(permission, TENANT)
    const locks = mocks.execute.mock.calls.map(([query]) => dialect.sqlToQuery(query))
    expect(locks.slice(0, 3).map(query => query.params)).toEqual([[ACTOR], [TENANT], [ACTOR, TENANT]])
    expect(locks[0].sql).toContain("FOR UPDATE")
    expect(locks[1].sql).toContain(operation.endsWith("CREATE") ? "FOR UPDATE" : "FOR SHARE")
    expect(locks[2].sql).toContain("FOR SHARE")
    expect(locks.every(query => !query.sql.includes('FROM "matches"'))).toBe(true)
    expect(mocks.user.mock.invocationCallOrder[1]).toBeGreaterThan(mocks.execute.mock.invocationCallOrder[2])
    expect(mocks.member.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.execute.mock.invocationCallOrder[2])
    expect(mocks.insert.mock.calls.at(-1)![0]).toBe(auditLogs)
    expect(mocks.values.mock.calls.at(-1)![0]).toMatchObject({ tenantId: TENANT, actorId: ACTOR, actorRole: "league_owner", method: operation })
    expect(mocks.revalidate.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.values.mock.invocationCallOrder.at(-1)!)
  })
  it.each([null, { id: OTHER }, { isActive: false }, { clerkId: "remapped" }, { clerkId: null }])("rechecks locked actor %s", async change => {
    mocks.user.mockReset().mockResolvedValueOnce(actor).mockResolvedValueOnce(change === null ? null : { ...actor, ...change })
    await expect(run(operation)).rejects.toThrow("access changed")
    noWrites()
  })
  it.each([null, { userId: OTHER }, { tenantId: OTHER }, { status: "suspended" }, { status: "pending" },
    ...["super_admin", "coach", "scorer", "player", "fan"].map(role => ({ role }))])("rejects invalid exact membership %s", async change => {
    mocks.member.mockResolvedValue(change === null ? null : { ...member, ...change })
    await expect(run(operation)).rejects.toThrow("access changed")
    noWrites()
  })
  it.each([null, { id: OTHER, isActive: true }, { id: TENANT, isActive: false }])("rejects unavailable league %s", async league => {
    mocks.league.mockResolvedValue(league)
    await expect(run(operation)).rejects.toThrow("access changed")
    noWrites()
  })
  it("rejects a missing provisioned account", async () => {
    mocks.user.mockResolvedValue(undefined)
    await expect(run(operation)).rejects.toThrow("account not found")
    noWrites()
  })
  it("rejects anonymous sessions before SQL", async () => {
    mocks.auth.mockResolvedValue({ userId: null })
    await expect(run(operation)).rejects.toThrow("Unauthorized")
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
  it("propagates active tenant resolution failure without fallback", async () => {
    mocks.tenant.mockRejectedValue(new Error("Resolution unavailable"))
    await expect(run(operation)).rejects.toThrow("Resolution unavailable")
    expect(mocks.fallback).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
  it("rejects missing active tenant", async () => {
    mocks.tenant.mockResolvedValue(null)
    await expect(run(operation)).rejects.toThrow("Tenant not found")
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
  it("checks explicit tenant permission before SQL", async () => {
    mocks.permission.mockImplementation(async (_permission, tenantId) => { if (tenantId) throw new Error("Forbidden") })
    await expect(run(operation)).rejects.toThrow("Forbidden")
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
  it("propagates audit failure without cache success", async () => {
    mocks.values.mockImplementation(row => row.method ? Promise.reject(new Error("Audit unavailable")) : { returning: mocks.returningInsert })
    await expect(run(operation)).rejects.toThrow("Audit unavailable")
    expect(mocks.revalidate).not.toHaveBeenCalled()
    // In-memory callback does not certify actual PostgreSQL rollback.
  })
})

describe("Team-scoped delegation, capacity and quota protocol", () => {
  it.each(["TEAM_UPDATE", "ROSTER_ADD", "ROSTER_REMOVE"] as const)("allows %s for a current assigned team manager", async operation => {
    mocks.member.mockResolvedValue({ ...member, role: "team_manager" })
    if (operation === "ROSTER_REMOVE") mocks.player.mockResolvedValue({ ...player, teamId: TEAM })
    await expect(run(operation)).resolves.toMatchObject({ success: true })
    expect(mocks.values.mock.calls.at(-1)![0].actorRole).toBe("team_manager")
  })
  it.each(["TEAM_UPDATE", "ROSTER_ADD", "ROSTER_REMOVE"] as const)("rejects an unassigned manager for %s", async operation => {
    mocks.member.mockResolvedValue({ ...member, role: "team_manager" })
    mocks.team.mockResolvedValue({ ...team, managerId: OTHER })
    await expect(run(operation)).rejects.toThrow("currently assigned")
    noWrites()
  })
  it.each(["TEAM_CREATE", "PLAYER_CREATE", "PLAYER_UPDATE"] as const)("does not elevate managers for %s", async operation => {
    mocks.member.mockResolvedValue({ ...member, role: "team_manager" })
    await expect(run(operation)).rejects.toThrow("access changed")
    noWrites()
  })
  it("keeps captain binding usable only with an active team_manager membership", async () => {
    mocks.member.mockResolvedValue({ ...member, role: "team_manager" })
    mocks.team.mockResolvedValue({ ...team, managerId: OTHER, captainId: ACTOR })
    await updateTeam(TEAM, { city: "City" })
  })
  it.each(["TEAM_CREATE", "PLAYER_CREATE"] as const)("checks %s count and current plan after the exclusive league lock", async operation => {
    await run(operation)
    expect(mocks.countWhere.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.execute.mock.invocationCallOrder[2])
    expect(dialect.sqlToQuery(mocks.countWhere.mock.calls[0][0]).params).toEqual([TENANT])
    expect(mocks.plan).toHaveBeenCalledWith({ plan: "pro", feature: operation === "TEAM_CREATE" ? "maxTeams" : "maxPlayers", current: 0 })
    expect(mocks.values.mock.calls[0][0].createdBy).toBe(ACTOR)
  })
  it.each(["TEAM_CREATE", "PLAYER_CREATE"] as const)("propagates a structured %s plan block before insert", async operation => {
    const error = Object.assign(new Error("Plan quota"), { code: "PLAN_LIMIT" })
    mocks.plan.mockImplementation(() => { throw error })
    await expect(run(operation)).rejects.toBe(error)
    noWrites()
  })
  it.each(["ROSTER_ADD", "PLAYER_UPDATE", "PLAYER_CREATE"] as const)("enforces the same full-squad check for %s", async operation => {
    mocks.countWhere.mockResolvedValue([{ total: 15 }])
    await expect(run(operation)).rejects.toThrow("squad limit")
    noWrites()
    const query = dialect.sqlToQuery(mocks.countWhere.mock.calls.at(-1)![0])
    expect(query.params).toEqual([TENANT, TEAM])
    const teamLock = mocks.execute.mock.calls.findIndex(([query]) => dialect.sqlToQuery(query).sql.includes('FROM "teams"'))
    expect(mocks.countWhere.mock.invocationCallOrder.at(-1)!).toBeGreaterThan(mocks.execute.mock.invocationCallOrder[teamLock])
  })
  it("refuses shrinking capacity below linked players under the same team lock", async () => {
    mocks.countWhere.mockResolvedValue([{ total: 12 }])
    await expect(updateTeam(TEAM, { maxSquadSize: 11 })).rejects.toThrow("lower than")
    noWrites()
  })
  it("allows capacity equal to roster size and does not default omitted settings", async () => {
    mocks.countWhere.mockResolvedValue([{ total: 12 }])
    await updateTeam(TEAM, { maxSquadSize: 12 })
    expect(mocks.set).toHaveBeenCalledWith({ maxSquadSize: 12, updatedAt: expect.any(Date) })
  })
  it("prevents managers changing tournament linkage", async () => {
    mocks.member.mockResolvedValue({ ...member, role: "team_manager" })
    await expect(updateTeam(TEAM, { tournamentId: TOURNAMENT })).rejects.toThrow("league owner")
    noWrites()
  })
  it.each([null, { id: TOURNAMENT, tenantId: OTHER, status: "live" }, { id: OTHER, tenantId: TENANT, status: "live" },
    { id: TOURNAMENT, tenantId: TENANT, status: "completed" }])("rejects invalid tournament %s", async tournament => {
    mocks.tournament.mockResolvedValue(tournament)
    await expect(createTeam({ name: "Team", tournamentId: TOURNAMENT })).rejects.toThrow("Tournament is unavailable")
    noWrites()
  })
})

describe("Player/roster lock ordering, eligibility and retries", () => {
  it("locks sorted current/target teams before player; rejects direct transfer without chasing locks", async () => {
    mocks.player.mockResolvedValue({ ...player, teamId: OTHER })
    await expect(updatePlayer(PLAYER, { teamId: TEAM })).rejects.toThrow("Remove the player")
    const locks = mocks.execute.mock.calls.map(([query]) => dialect.sqlToQuery(query))
    expect(locks[3].params).toEqual([TENANT, ...[TEAM, OTHER].sort()])
    expect(locks[3].sql).toContain("ORDER BY")
    expect(locks[4].params).toEqual([PLAYER, TENANT])
    noWrites()
  })
  it.each([null, { ...player, id: OTHER }, { ...player, tenantId: OTHER }])("rejects missing/foreign player %s", async current => {
    mocks.player.mockResolvedValue(current)
    await expect(addPlayerToTeam(TEAM, PLAYER)).rejects.toThrow("Player not found")
    noWrites()
  })
  it("rechecks team link after waiting for player lock and rejects drift", async () => {
    mocks.player.mockReset().mockResolvedValueOnce(player).mockResolvedValueOnce({ ...player, teamId: OTHER })
    await expect(addPlayerToTeam(TEAM, PLAYER)).rejects.toThrow("Player team changed")
    expect(mocks.execute).toHaveBeenCalledTimes(5)
    noWrites()
  })
  it("uses current eligibility after the player-lock wait, not the discovery row", async () => {
    mocks.player.mockReset().mockResolvedValueOnce(player).mockResolvedValueOnce({ ...player, status: "suspended" })
    await expect(addPlayerToTeam(TEAM, PLAYER)).rejects.toThrow("Only active players")
    noWrites()
  })
  it.each([null, { ...team, id: OTHER }, { ...team, tenantId: OTHER }, { ...team, isActive: false }])("rejects foreign/inactive team %s", async current => {
    mocks.team.mockResolvedValue(current)
    await expect(addPlayerToTeam(TEAM, PLAYER)).rejects.toThrow("Team is unavailable")
    noWrites()
  })
  it.each(["ROSTER_ADD", "PLAYER_UPDATE", "PLAYER_CREATE", "ROSTER_REMOVE"] as const)("protects in-play eligibility for %s without match locks", async operation => {
    if (operation === "ROSTER_REMOVE") mocks.player.mockResolvedValue({ ...player, teamId: TEAM })
    mocks.match.mockResolvedValue({ id: OTHER })
    await expect(run(operation)).rejects.toThrow("team is playing")
    const query = dialect.sqlToQuery(mocks.match.mock.calls[0][0].where)
    expect(query.params).toEqual([TENANT, TEAM, TEAM, "toss", "live", "innings_break"])
    expect(mocks.match.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.execute.mock.invocationCallOrder.at(-1)!)
    noWrites()
  })
  it("allows contact-only edits during play, but prevents eligibility status change", async () => {
    mocks.player.mockResolvedValue({ ...player, teamId: TEAM })
    mocks.match.mockResolvedValue({ id: OTHER })
    await updatePlayer(PLAYER, { phone: "123" })
    expect(mocks.match).not.toHaveBeenCalled()
    expect(JSON.stringify(mocks.values.mock.calls[0][0])).not.toContain('"123"')
    expect(dialect.sqlToQuery(mocks.where.mock.calls[0][0]).params).toEqual([PLAYER, TENANT])
  })
  it("blocks an assigned player's eligibility status change during play", async () => {
    mocks.player.mockResolvedValue({ ...player, teamId: TEAM })
    mocks.match.mockResolvedValue({ id: OTHER })
    await expect(updatePlayer(PLAYER, { status: "injured" })).rejects.toThrow("team is playing")
    noWrites()
  })
  it.each(["injured", "retired", "suspended", "inactive"] as const)("does not bypass join eligibility through create or generic patch: %s", async status => {
    await expect(createPlayer({ name: "Player", teamId: TEAM, status })).rejects.toThrow("Only active players")
    await expect(updatePlayer(PLAYER, { teamId: TEAM, status })).rejects.toThrow("Only active players")
    noWrites()
  })
  it("does not restore archived player eligibility via the generic edit command", async () => {
    mocks.player.mockResolvedValue({ ...player, isActive: false, status: "inactive" })
    await expect(updatePlayer(PLAYER, { status: "active" })).rejects.toThrow("Archived players")
    noWrites()
  })
  it("does not rewrite/audit a still-authorized same-team add retry", async () => {
    mocks.member.mockResolvedValue({ ...member, role: "team_manager" })
    mocks.player.mockResolvedValue({ ...player, teamId: TEAM, phone: "private", email: "private@example.test",
      userId: ACTOR, profileId: OTHER, dateOfBirth: "2000-02-29", biography: "Private biography" })
    const result = await addPlayerToTeam(TEAM, PLAYER)
    expect(result.player).toEqual({ id: PLAYER, name: player.name, teamId: TEAM })
    expect(mocks.countWhere).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.insert).not.toHaveBeenCalled()
  })
  it("does not rewrite/audit an authorized already-unassigned remove retry", async () => {
    await removePlayerFromTeam(TEAM, PLAYER)
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.insert).not.toHaveBeenCalled()
  })
  it("allows explicit unlink without touching global identities/history", async () => {
    mocks.player.mockResolvedValue({ ...player, teamId: TEAM })
    await updatePlayer(PLAYER, { teamId: null })
    expect(mocks.set).toHaveBeenCalledExactlyOnceWith({ teamId: null, updatedAt: expect.any(Date) })
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith(players)
  })
  it("rejects a lost update before audit", async () => {
    mocks.returning.mockResolvedValue([])
    await expect(addPlayerToTeam(TEAM, PLAYER)).rejects.toThrow("Player changed")
    expect(mocks.insert).not.toHaveBeenCalled()
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
})

describe("Strict roster payloads", () => {
  it.each(["id", "createdBy", "managerId", "captainId", "isActive"])("rejects injected team create field %s", async field => {
    await expect(createTeam({ name: "Team", [field]: OTHER } as never)).rejects.toThrow()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
  it.each(["id", "createdBy", "userId", "profileId", "isActive"])("rejects injected player create field %s", async field => {
    await expect(createPlayer({ name: "Player", [field]: OTHER } as never)).rejects.toThrow()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
  it.each(["id", "tenantId", "createdBy", "managerId", "captainId", "isActive"])("rejects injected team patch field %s", async field => {
    await expect(updateTeam(TEAM, { [field]: OTHER } as never)).rejects.toThrow()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
  it.each(["id", "tenantId", "createdBy", "userId", "profileId", "isActive"])("rejects injected player patch field %s", async field => {
    await expect(updatePlayer(PLAYER, { [field]: OTHER } as never)).rejects.toThrow()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
  it.each([() => createTeam({ name: "Team", tenantId: OTHER }), () => createPlayer({ name: "Player", tenantId: OTHER })])(
    "rejects forged create tenant before transaction", async command => {
      await expect(command()).rejects.toThrow("Invalid tenant")
      expect(mocks.transaction).not.toHaveBeenCalled()
    },
  )
  it.each(["2026-02-30", "2025-02-29", "not a date", "9999-12-31"])("rejects invalid DOB %s before SQL", async dateOfBirth => {
    await expect(updatePlayer(PLAYER, { dateOfBirth })).rejects.toThrow()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
  it("accepts a valid leap-day DOB and nullable profile fields", async () => {
    await updatePlayer(PLAYER, { dateOfBirth: "2000-02-29", phone: null })
    expect(mocks.set).toHaveBeenCalledWith({ dateOfBirth: "2000-02-29", phone: null, updatedAt: expect.any(Date) })
  })
  it.each(["http://example.test/photo.png", "https://user:pass@example.test/photo.png", "javascript:alert(1)"])("rejects unsafe image URL %s", async photoUrl => {
    await expect(updatePlayer(PLAYER, { photoUrl })).rejects.toThrow()
    await expect(createTeam({ name: "Team", logoUrl: photoUrl })).rejects.toThrow()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
  it("keeps explicit HTTPS images and omitted/undefined fields separate from nullable clears", async () => {
    await updatePlayer(PLAYER, { photoUrl: "https://example.test/photo.png", phone: undefined, email: null })
    expect(mocks.set).toHaveBeenCalledWith({ photoUrl: "https://example.test/photo.png", email: null, updatedAt: expect.any(Date) })
  })
  it("does not default or write an empty team patch after current authorization", async () => {
    await updateTeam(TEAM, {})
    expect(mocks.member).toHaveBeenCalledOnce()
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.insert).not.toHaveBeenCalled()
  })
  it("generates bounded nonempty slugs for non-Latin names without discarding the display name", async () => {
    await createTeam({ name: "کراچی" })
    expect(mocks.values.mock.calls[0][0].name).toBe("کراچی")
    expect(mocks.values.mock.calls[0][0].slug).toMatch(/^team-[a-f0-9-]+$/)
  })
})
