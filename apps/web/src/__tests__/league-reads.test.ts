import { beforeEach, describe, expect, it, vi } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import { battingScorecards, bowlingScorecards, fieldingScorecards, matches, players, teams } from "@mtk/database"
import {
  requireActiveLeagueContext, readBattingLeaderboard, readBowlingLeaderboard,
  readComparisonRoster, readPlayerComparison, readScoringConsoleMatches,
  leaderboardLimit, comparisonRosterLimit, scoringConsoleLimit,
} from "@/lib/league-reads"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), tenant: vi.fn(), permission: vi.fn(),
  select: vi.fn(), user: vi.fn(), member: vi.fn(), league: vi.fn(),
  queries: [] as any[], state: {} as any,
}))
vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }))
vi.mock("@/lib/rbac-server", () => ({ resolveActiveTenantId: mocks.tenant, requirePermissionServer: mocks.permission }))
vi.mock("@mtk/database", async (original) => ({ ...await original<typeof import("@mtk/database")>(), db: {
  select: mocks.select,
  query: { users: { findFirst: mocks.user }, userTenantRoles: { findFirst: mocks.member }, tenants: { findFirst: mocks.league } } } }))

const TENANT = "00000000-0000-4000-8000-000000000001"
const OTHER = "00000000-0000-4000-8000-000000000009"
const ACTOR = "00000000-0000-4000-8000-000000000002"
const TEAM = "00000000-0000-4000-8000-000000000003"
const TEAM_B = "00000000-0000-4000-8000-000000000004"
const PLAYER = "00000000-0000-4000-8000-000000000005"
const CLERK = "user_clerk_identity"
const actor = { id: ACTOR, clerkId: CLERK, isActive: true }
const member = { userId: ACTOR, tenantId: TENANT, role: "league_owner", status: "active" }
const dialect = new PgDialect()

function rowsFor(record: any, fields: any) {
  if (record.table === matches) return mocks.state.matches
  if (record.table === teams) return mocks.state.teamRows
  if (record.table === battingScorecards) return fields ? mocks.state.battingLeaders : mocks.state.batting
  if (record.table === bowlingScorecards) return fields ? mocks.state.bowlingLeaders : mocks.state.bowling
  if (record.table === fieldingScorecards) return mocks.state.fielding
  if (record.table === players) {
    return (record.params?.length ?? 0) > 1
      ? (mocks.state.comparisonPlayer ? [mocks.state.comparisonPlayer] : [])
      : mocks.state.roster
  }
  return []
}

function selectChain(fields: any) {
  const record: any = { fields, joins: [], params: [] }
  mocks.queries.push(record)
  const chain: any = {
    from: (table: any) => { record.table = table; return chain },
    innerJoin: (table: any, on: any) => { record.joins.push({ table, params: dialect.sqlToQuery(on).params }); return chain },
    where: (where: any) => { const query = dialect.sqlToQuery(where); record.params = query.params; record.whereSql = query.sql; return chain },
    groupBy: () => chain,
    orderBy: (...order: any[]) => { record.orders = order.map((entry: any) => dialect.sqlToQuery(entry)); return chain },
    limit: (limit: number) => { record.limit = limit; return chain },
    then: (resolve: any, reject: any) => Promise.resolve(rowsFor(record, fields)).then(resolve, reject),
  }
  return chain
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.queries.length = 0
  mocks.state = {
    actor, member, league: { id: TENANT, isActive: true },
    roster: [{ id: PLAYER, name: "Player" }], comparisonPlayer: { id: PLAYER, name: "Player" },
    battingLeaders: [{ playerId: PLAYER, playerName: "Player", teamName: "Team", total: "80" }],
    bowlingLeaders: [{ playerId: PLAYER, playerName: "Player", teamName: "Team", total: "3" }],
    batting: [], bowling: [], fielding: [],
    matches: [], teamRows: [],
  }
  mocks.auth.mockResolvedValue({ userId: CLERK })
  mocks.tenant.mockResolvedValue(TENANT)
  mocks.permission.mockResolvedValue(undefined)
  mocks.user.mockImplementation(async () => mocks.state.actor)
  mocks.member.mockImplementation(async () => mocks.state.member)
  mocks.league.mockImplementation(async () => mocks.state.league)
  mocks.select.mockImplementation(selectChain)
})

describe("requireActiveLeagueContext resolves the exact active league", () => {
  it("returns the context after the exact-league permission check", async () => {
    await expect(requireActiveLeagueContext("stats:read")).resolves
      .toMatchObject({ tenantId: TENANT, actorId: ACTOR, clerkId: CLERK, role: "league_owner" })
    expect(mocks.permission).toHaveBeenCalledWith("stats:read", TENANT)
  })
  it("rejects an unauthenticated caller before resolving a tenant or permission", async () => {
    mocks.auth.mockResolvedValue({ userId: null })
    await expect(requireActiveLeagueContext("stats:read")).rejects.toThrow("Unauthorized")
    expect(mocks.tenant).not.toHaveBeenCalled()
    expect(mocks.permission).not.toHaveBeenCalled()
  })
  it("rejects a caller with no active league", async () => {
    mocks.tenant.mockResolvedValue(null)
    await expect(requireActiveLeagueContext("stats:read")).rejects.toThrow("Tenant not found")
    expect(mocks.permission).not.toHaveBeenCalled()
  })
  it("rejects a missing or inactive account", async () => {
    mocks.state.actor = undefined
    await expect(requireActiveLeagueContext("stats:read")).rejects.toThrow("league account unavailable")
    mocks.state.actor = { ...actor, isActive: false }
    await expect(requireActiveLeagueContext("stats:read")).rejects.toThrow("league account unavailable")
    mocks.state.actor = { ...actor, clerkId: "someone_else" }
    await expect(requireActiveLeagueContext("stats:read")).rejects.toThrow("league account unavailable")
  })
  it("rejects a missing, suspended, super-admin or wrong-league membership", async () => {
    for (const bad of [
      null, { ...member, status: "suspended" }, { ...member, role: "super_admin" }, { ...member, tenantId: OTHER },
    ]) {
      mocks.state.member = bad
      await expect(requireActiveLeagueContext("stats:read")).rejects.toThrow("league access unavailable")
    }
  })
  it("rejects a role without the requested permission and an inactive league", async () => {
    mocks.state.member = { ...member, role: "fan" }
    await expect(requireActiveLeagueContext("match:score")).rejects.toThrow("league access unavailable")
    mocks.state.member = member
    mocks.state.league = { id: TENANT, isActive: false }
    await expect(requireActiveLeagueContext("stats:read")).rejects.toThrow("league access unavailable")
  })
})

describe("Leaderboards are bounded and scoped to the active league", () => {
  it.each([["runs"], ["sixes"], ["fours"]] as const)("maps the %s metric and joins players/teams by league", async (metric) => {
    await readBattingLeaderboard(TENANT, metric)
    const query = mocks.queries.at(-1)!
    expect(query.table).toBe(battingScorecards)
    expect(query.params).toEqual([TENANT])
    expect(query.joins.map((join: any) => join.table)).toEqual([players, teams])
    for (const join of query.joins) expect(join.params).toEqual([TENANT])
    expect(query.orders[0].sql).toContain(metric)
    expect(query.limit).toBe(5)
  })
  it("returns the aggregated rows", async () => {
    await expect(readBattingLeaderboard(TENANT, "runs", 3)).resolves
      .toEqual([{ playerId: PLAYER, playerName: "Player", teamName: "Team", total: "80" }])
    expect(mocks.queries.at(-1)!.limit).toBe(3)
  })
  it("rejects an out-of-range leaderboard limit before querying", async () => {
    expect(() => leaderboardLimit.parse(0)).toThrow()
    expect(() => leaderboardLimit.parse(51)).toThrow()
    expect(leaderboardLimit.parse(50)).toBe(50)
  })
  it("scopes the bowling leaderboard to the league and orders by wickets", async () => {
    await readBowlingLeaderboard(TENANT)
    const query = mocks.queries.at(-1)!
    expect(query.table).toBe(bowlingScorecards)
    expect(query.params).toEqual([TENANT])
    for (const join of query.joins) expect(join.params).toEqual([TENANT])
    expect(query.orders[0].sql).toContain("wickets")
  })
})

describe("Player comparison stays inside the active league", () => {
  it("scopes the roster to the league and bounds it", async () => {
    await readComparisonRoster(TENANT)
    const query = mocks.queries.at(-1)!
    expect(query.table).toBe(players)
    expect(query.params).toEqual([TENANT])
    expect(query.limit).toBe(100)
    expect(comparisonRosterLimit.parse(200)).toBe(200)
    expect(() => comparisonRosterLimit.parse(201)).toThrow()
  })
  it("returns null for a missing or foreign player without reading scorecards", async () => {
    mocks.state.comparisonPlayer = null
    await expect(readPlayerComparison(TENANT, PLAYER)).resolves.toBeNull()
    expect(mocks.queries.filter((query) => query.table === battingScorecards)).toHaveLength(0)
  })
  it("rejects an invalid player id before any query", async () => {
    await expect(readPlayerComparison(TENANT, "not-a-uuid")).rejects.toThrow()
    expect(mocks.select).not.toHaveBeenCalled()
  })
  it("aggregates tenant-scoped batting, bowling and fielding", async () => {
    mocks.state.batting = [
      { runs: 50, ballsFaced: 40, dismissalType: "caught" },
      { runs: 30, ballsFaced: 20, dismissalType: "not_out" },
    ]
    mocks.state.bowling = [{ wickets: 3, runsConceded: 60, ballsBowled: 48 }]
    mocks.state.fielding = [{ catches: 2, runOuts: 1, stumpings: 0 }]
    await expect(readPlayerComparison(TENANT, PLAYER)).resolves.toEqual({
      id: PLAYER, name: "Player", runs: 80, battingAverage: 80, strikeRate: 133.33,
      wickets: 3, bowlingAverage: 20, economy: 7.5, catches: 3,
    })
    for (const table of [battingScorecards, bowlingScorecards, fieldingScorecards]) {
      const query = mocks.queries.find((entry) => entry.table === table)!
      expect(query.params).toEqual([PLAYER, TENANT])
    }
  })
})

describe("Scoring console reads are league-scoped, bounded and named safely", () => {
  it("resolves same-league team names and never a foreign team", async () => {
    mocks.state.matches = [
      { id: "m1", tenantId: TENANT, status: "live", scheduledDate: null, teamAId: TEAM, teamBId: TEAM_B },
    ]
    mocks.state.teamRows = [{ id: TEAM, name: "Alpha" }]
    const result = await readScoringConsoleMatches(TENANT)
    expect(result.truncated).toBe(false)
    expect(result.matches[0]).toMatchObject({ teamAName: "Alpha", teamBName: "TBD Team B" })
    const matchQuery = mocks.queries.find((entry) => entry.table === matches)!
    expect(matchQuery.params).toContain(TENANT)
    expect(matchQuery.params).toEqual(expect.arrayContaining(["live", "scheduled", "toss", "innings_break"]))
    expect(matchQuery.limit).toBe(scoringConsoleLimit + 1)
    const teamQuery = mocks.queries.find((entry) => entry.table === teams)!
    expect(teamQuery.params).toEqual([TENANT, TEAM, TEAM_B])
  })
  it("flags truncation beyond the console bound", async () => {
    mocks.state.matches = Array.from({ length: scoringConsoleLimit + 1 }, (_, index) => ({
      id: `m${index}`, tenantId: TENANT, status: "scheduled", scheduledDate: null, teamAId: TEAM, teamBId: TEAM,
    }))
    const result = await readScoringConsoleMatches(TENANT)
    expect(result.truncated).toBe(true)
    expect(result.matches).toHaveLength(scoringConsoleLimit)
  })
  it("skips the team lookup when there are no active matches", async () => {
    const result = await readScoringConsoleMatches(TENANT)
    expect(result).toEqual({ truncated: false, matches: [] })
    expect(mocks.queries).toHaveLength(1)
  })
})
