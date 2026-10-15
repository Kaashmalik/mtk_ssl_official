import { beforeEach, describe, expect, it, vi } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import { teams, players } from "@mtk/database"
import { getTeam, getTeamWithRoster, getTeams } from "@/app/actions/teams"
import { getPlayer, getPlayers } from "@/app/actions/players"
import { requireRosterReadContext, readEditableRosterPlayer, readRosterTeamOptions, canManageRosterTeam,
  rosterPageNumber, type RosterReadContext } from "@/lib/roster-reads"

const mocks = vi.hoisted(() => ({ auth: vi.fn(), tenant: vi.fn(), permission: vi.fn(), fallback: vi.fn(),
  user: vi.fn(), membership: vi.fn(), league: vi.fn(), select: vi.fn(), failure: null as Error | null,
  teamRows: [] as any[], playerRows: [] as any[], queries: [] as any[] }))
vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/rbac-server", () => ({ resolveActiveTenantId: mocks.tenant, requirePermissionServer: mocks.permission }))
vi.mock("@/app/actions/tenants", () => ({ getMyTenant: mocks.fallback }))
vi.mock("@mtk/database", async original => ({ ...await original<typeof import("@mtk/database")>(), db: {
  select: mocks.select, query: { users: { findFirst: mocks.user }, userTenantRoles: { findFirst: mocks.membership }, tenants: { findFirst: mocks.league } },
} }))
const TENANT = "00000000-0000-4000-8000-000000000001"
const ACTOR = "00000000-0000-4000-8000-000000000002"
const TEAM = "00000000-0000-4000-8000-000000000003"
const PLAYER = "00000000-0000-4000-8000-000000000004"
const OTHER = "00000000-0000-4000-8000-000000000005"
const actor = { id: ACTOR, clerkId: "clerk", isActive: true, role: "super_admin", tenantIds: [TENANT] }
const membership = { userId: ACTOR, tenantId: TENANT, role: "league_owner", status: "active" }
const context: RosterReadContext = { tenantId: TENANT, actorId: ACTOR, clerkId: "clerk", role: "league_owner" }
const team = { id: TEAM, tenantId: TENANT, name: "Team", isActive: true, managerId: ACTOR, captainId: null, createdBy: "hidden creator" }
const player = { id: PLAYER, tenantId: TENANT, teamId: TEAM, name: "Player", status: "active", isActive: true,
  phone: "private-phone", email: "private@example.test", dateOfBirth: "2000-02-29", heightCm: 175, weightKg: 70,
  biography: "private biography", userId: ACTOR, profileId: OTHER, createdBy: "private creator" }
const dialect = new PgDialect()
const readers = ["team", "squad", "teams", "player", "players"] as const
function read(kind: typeof readers[number]) {
  switch (kind) {
    case "team": return getTeam(TEAM)
    case "squad": return getTeamWithRoster(TEAM)
    case "teams": return getTeams({})
    case "player": return getPlayer(PLAYER)
    case "players": return getPlayers({})
  }
}
beforeEach(() => {
  vi.resetAllMocks()
  mocks.queries.length = 0
  mocks.failure = null
  mocks.teamRows = [team]
  mocks.playerRows = [player]
  mocks.auth.mockResolvedValue({ userId: "clerk" })
  mocks.tenant.mockResolvedValue(TENANT)
  mocks.permission.mockResolvedValue(undefined)
  mocks.fallback.mockImplementation(() => { throw new Error("Wrong fallback") })
  mocks.user.mockResolvedValue(actor)
  mocks.membership.mockResolvedValue(membership)
  mocks.league.mockResolvedValue({ id: TENANT, isActive: true })
  mocks.select.mockImplementation(fields => {
    const record: any = { fields, joins: [], orders: [] }
    mocks.queries.push(record)
    const rows = () => fields.total ? [{ total: "1" }] : (record.table === teams ? mocks.teamRows : mocks.playerRows)
      .map(row => Object.fromEntries(Object.keys(fields).map(key => [key, row[key]])))
    const chain: any = {
      from: (table: any) => { record.table = table; return chain },
      leftJoin: (table: any, where: any) => { record.joins.push({ table, ...dialect.sqlToQuery(where) }); return chain },
      where: (where: any) => { Object.assign(record, dialect.sqlToQuery(where)); return chain },
      orderBy: (...orders: any[]) => { record.orders = orders.map(order => dialect.sqlToQuery(order)); return chain },
      limit: (limit: number) => { record.limit = limit; return chain },
      offset: (offset: number) => { record.offset = offset; return chain },
      then: (resolve: any, reject: any) => mocks.failure ? Promise.reject(mocks.failure).then(resolve, reject) : Promise.resolve(rows()).then(resolve, reject),
    }
    return chain
  })
})

describe.each(readers)("%s read authorization boundary", kind => {
  it("uses explicit active-league authority before scoped business reads, not a legacy repo/context", async () => {
    await read(kind)
    expect(mocks.permission).toHaveBeenCalledWith(kind.startsWith("player") ? "player:read" : "team:read", TENANT)
    expect(dialect.sqlToQuery(mocks.membership.mock.calls[0][0].where).params).toEqual([ACTOR, TENANT])
    expect(mocks.select.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.league.mock.invocationCallOrder[0])
    expect(mocks.queries.every(query => query.params.includes(TENANT))).toBe(true)
    expect(mocks.fallback).not.toHaveBeenCalled()
  })
  it("rejects anonymous sessions before business SQL", async () => {
    mocks.auth.mockResolvedValue({ userId: null })
    await expect(read(kind)).rejects.toThrow("Unauthorized")
    expect(mocks.select).not.toHaveBeenCalled()
  })
  it("does not switch leagues when resolution fails", async () => {
    mocks.tenant.mockRejectedValue(new Error("Resolution unavailable"))
    await expect(read(kind)).rejects.toThrow("Resolution unavailable")
    expect(mocks.select).not.toHaveBeenCalled()
    expect(mocks.fallback).not.toHaveBeenCalled()
  })
  it("rejects missing active league", async () => {
    mocks.tenant.mockResolvedValue(null)
    await expect(read(kind)).rejects.toThrow("Tenant not found")
    expect(mocks.select).not.toHaveBeenCalled()
  })
  it("enforces the exact league permission even if the outer precheck passes", async () => {
    mocks.permission.mockImplementation(async (_permission, tenantId) => { if (tenantId) throw new Error("Forbidden") })
    await expect(read(kind)).rejects.toThrow("Forbidden")
    expect(mocks.user).not.toHaveBeenCalled()
    expect(mocks.select).not.toHaveBeenCalled()
  })
  it.each([null, { ...actor, isActive: false }, { ...actor, clerkId: "remapped" }])("denies unavailable current account %s", async current => {
    mocks.user.mockResolvedValue(current)
    await expect(read(kind)).rejects.toThrow("Forbidden")
    expect(mocks.select).not.toHaveBeenCalled()
  })
  it.each([null, { ...membership, userId: OTHER }, { ...membership, tenantId: OTHER },
    { ...membership, status: "suspended" }, { ...membership, status: "pending" }, { ...membership, role: "super_admin" }])(
    "does not fall back to global role/tenant arrays for invalid membership %s", async current => {
      mocks.membership.mockResolvedValue(current)
      await expect(read(kind)).rejects.toThrow("Forbidden")
      expect(mocks.select).not.toHaveBeenCalled()
    },
  )
  it.each([null, { id: OTHER, isActive: true }, { id: TENANT, isActive: false }])("denies unavailable league %s", async league => {
    mocks.league.mockResolvedValue(league)
    await expect(read(kind)).rejects.toThrow("Forbidden")
    expect(mocks.select).not.toHaveBeenCalled()
  })
  it("propagates database failure rather than a false empty state", async () => {
    mocks.failure = new Error("Database unavailable")
    await expect(read(kind)).rejects.toThrow("Database unavailable")
  })
})

describe("Player read field allowlists and resource hierarchy", () => {
  it.each(["player", "players", "squad"] as const)("never selects private/identity fields for %s, even for an owner", async kind => {
    const result = await read(kind)
    expect(JSON.stringify(result)).not.toMatch(/private|2000-02-29|profileId|userId|createdBy|heightCm|weightKg|biography/)
    for (const query of mocks.queries.filter(query => query.table === players)) {
      expect(Object.keys(query.fields)).not.toEqual(expect.arrayContaining(["email", "phone"]))
      for (const key of ["email", "phone", "dateOfBirth", "heightCm", "weightKg", "biography", "profileId", "userId", "createdBy"]) {
        expect(query.fields).not.toHaveProperty(key)
      }
    }
  })
  it("separates privileged edit fields from ordinary reads and excludes global identity/creator pointers", async () => {
    const result = await readEditableRosterPlayer(context, PLAYER)
    expect(result).toMatchObject({ email: player.email, phone: player.phone, dateOfBirth: player.dateOfBirth })
    expect(result).not.toHaveProperty("userId")
    expect(result).not.toHaveProperty("profileId")
    expect(result).not.toHaveProperty("createdBy")
    expect(mocks.queries[0].params).toEqual([PLAYER, TENANT])
  })
  it.each(["team_manager", "coach", "scorer", "player", "fan", "super_admin"] as const)("denies private edit fields for %s before SQL", async role => {
    await expect(readEditableRosterPlayer({ ...context, role }, PLAYER)).rejects.toThrow("Forbidden")
    expect(mocks.select).not.toHaveBeenCalled()
  })
  it("binds a player detail and each joined team to the same active league", async () => {
    await getPlayer(PLAYER)
    expect(mocks.queries[0].params).toEqual([PLAYER, TENANT])
    expect(mocks.queries[0].joins[0].params).toEqual([TENANT])
    expect(mocks.queries[0].joins[0].sql).toContain('"teams"."id" = "players"."team_id"')
    expect(mocks.queries[0].fields.teamId).toBe(teams.id)
  })
  it("returns null for a missing/foreign parent without roster queries", async () => {
    mocks.teamRows = []
    await expect(getTeamWithRoster(OTHER)).resolves.toBeNull()
    expect(mocks.queries).toHaveLength(1)
    expect(mocks.queries[0].params).toEqual([OTHER, TENANT])
  })
  it("requires player read permission before a team roster is read", async () => {
    mocks.permission.mockImplementation(async (permission, tenantId) => { if (permission === "player:read" && tenantId) throw new Error("Forbidden roster") })
    await expect(getTeamWithRoster(TEAM)).rejects.toThrow("Forbidden roster")
    expect(mocks.select).not.toHaveBeenCalled()
  })
  it("binds roster children by tenant and parent without selecting contact fields", async () => {
    await getTeamWithRoster(TEAM)
    expect(mocks.queries[1].params).toEqual([TENANT, TEAM])
    expect(mocks.queries[1].orders.map((order: any) => order.sql)).toEqual(['"players"."name" asc', '"players"."id" asc'])
  })
  it.each([() => getTeam("bad"), () => getPlayer("bad"), () => getTeamWithRoster("bad")])("rejects invalid resource IDs before business SQL", async command => {
    await expect(command()).rejects.toThrow()
    expect(mocks.select).not.toHaveBeenCalled()
  })
})

describe("Bounded roster filters, counts and deterministic pages", () => {
  it.each(["teams", "players"] as const)("rejects forged %s scope rather than overwriting it", async kind => {
    await expect(kind === "teams" ? getTeams({ tenantId: OTHER }) : getPlayers({ tenantId: OTHER })).rejects.toThrow("Invalid tenant")
    expect(mocks.select).not.toHaveBeenCalled()
  })
  it.each(["teams", "players"] as const)("scopes both %s list/count and secondary sort", async kind => {
    const result = await (kind === "teams" ? getTeams({ page: 3, pageSize: 10, search: "A%_\\B", sortOrder: "desc" })
      : getPlayers({ page: 3, pageSize: 10, search: "A%_\\B", sortOrder: "desc" }))
    expect(result.pagination).toEqual({ page: 3, pageSize: 10, total: 1, totalPages: 1 })
    expect(mocks.queries[0].params).toEqual([TENANT, "%A\\%\\_\\\\B%"])
    expect(mocks.queries[1].params).toEqual(mocks.queries[0].params)
    expect(mocks.queries[0].limit).toBe(10)
    expect(mocks.queries[0].offset).toBe(20)
    expect(mocks.queries[0].orders).toHaveLength(2)
    expect(mocks.queries[0].orders[0].sql).toContain("desc")
    expect(mocks.queries[0].orders[1].sql).toContain('"id" asc')
    expect(mocks.queries).toHaveLength(2)
  })
  it.each([{ page: 0 }, { page: 1000001 }, { pageSize: 200 }, { search: "x".repeat(101) }, { createdBy: ACTOR }, { sortBy: "email" }])(
    "rejects invalid/overposted filters %s", async filters => {
      await expect(getTeams(filters as never)).rejects.toThrow()
      await expect(getPlayers(filters as never)).rejects.toThrow()
      expect(mocks.select).not.toHaveBeenCalled()
    },
  )
  it("only offers actually unassigned active players, not foreign or other-team links", async () => {
    await getPlayers({ unassigned: true, isActive: true, status: "active" })
    expect(mocks.queries[0].params).toEqual([TENANT, "active", true])
    expect(mocks.queries[0].sql).toContain('"players"."team_id" is null')
    expect(mocks.queries[1].sql).toBe(mocks.queries[0].sql)
    await expect(getPlayers({ teamId: TEAM, unassigned: true })).rejects.toThrow("Choose a team")
  })
  it("filters joined team IDs rather than following a foreign parent", async () => {
    await getPlayers({ teamId: OTHER })
    expect(mocks.queries[0].params).toEqual([TENANT, OTHER])
    expect(mocks.queries[0].sql).toContain('"teams"."id" =')
    expect(mocks.queries[0].joins[0].params).toEqual([TENANT])
  })
  it("binds every team summary subquery to the league and counts only opposing-side wins as losses", async () => {
    await getTeams({})
    for (const key of ["playerCount", "wins", "losses", "played"]) {
      const query = dialect.sqlToQuery(mocks.queries[0].fields[key])
      expect(query.params).toEqual([TENANT])
      expect(query.sql).toContain('"tenant_id" =')
    }
    const loss = dialect.sqlToQuery(mocks.queries[0].fields.losses).sql
    expect(loss).toContain('"matches"."winner_id" = "matches"."team_b_id"')
    expect(loss).toContain('"matches"."winner_id" = "matches"."team_a_id"')
    expect(mocks.queries[0].fields).not.toHaveProperty("createdBy")
  })
  it("reports team option truncation and queries only same-league active ID/name fields", async () => {
    mocks.teamRows = Array.from({ length: 101 }, (_, i) => ({ ...team, id: String(i) }))
    const result = await readRosterTeamOptions(TENANT)
    expect(result.teams).toHaveLength(100)
    expect(result.truncated).toBe(true)
    expect(mocks.queries[0].limit).toBe(101)
    expect(mocks.queries[0].params).toEqual([TENANT, true])
    expect(Object.keys(mocks.queries[0].fields)).toEqual(["id", "name"])
  })
  it.each([undefined, "1", "2"])("accepts bounded route page %s", page => { expect(rosterPageNumber(page)).toBe(Number(page ?? 1)) })
  it.each(["bad", "0", "1.5", "1000001", ["1", "2"]])("rejects invalid route page %s", page => { expect(() => rosterPageNumber(page)).toThrow() })
})

describe("Team control policy mirrors locked writers", () => {
  it.each([
    ["league_owner", ACTOR, null, true, true], ["team_manager", ACTOR, null, true, true],
    ["team_manager", OTHER, ACTOR, true, true], ["team_manager", OTHER, null, true, false],
    ["coach", ACTOR, ACTOR, true, false], ["scorer", ACTOR, ACTOR, true, false],
    ["fan", ACTOR, ACTOR, true, false], ["super_admin", ACTOR, ACTOR, true, false],
    ["league_owner", ACTOR, null, false, false],
  ] as const)("%s manager=%s captain=%s active=%s gives manage=%s", (role, managerId, captainId, isActive, allowed) => {
    expect(canManageRosterTeam({ ...context, role }, { isActive, managerId, captainId })).toBe(allowed)
  })
  it("returns the current exact membership rather than the global admin role", async () => {
    mocks.membership.mockResolvedValue({ ...membership, role: "scorer" })
    await expect(requireRosterReadContext("player:read")).resolves.toMatchObject({ role: "scorer", tenantId: TENANT, actorId: ACTOR })
  })
})
