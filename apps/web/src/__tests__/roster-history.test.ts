import { beforeEach, describe, expect, it, vi } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import { teams, tournaments, matches, matchInnings, battingScorecards, bowlingScorecards, fanFollows } from "@mtk/database"
import { readRosterTeamHistory, readRosterPlayerHistory, readRosterFollowState, rosterHistoricalSide } from "@/lib/roster-history"

const mocks = vi.hoisted(() => ({ select: vi.fn(), queries: [] as any[], rows: new Map<any, any[]>(), failure: null as Error | null }))
vi.mock("@mtk/database", async original => ({ ...await original<typeof import("@mtk/database")>(), db: { select: mocks.select } }))
const TENANT = "00000000-0000-4000-8000-000000000001"
const TEAM = "00000000-0000-4000-8000-000000000002"
const OPPONENT = "00000000-0000-4000-8000-000000000003"
const PLAYER = "00000000-0000-4000-8000-000000000004"
const MATCH = "00000000-0000-4000-8000-000000000005"
const TOURNAMENT = "00000000-0000-4000-8000-000000000006"
const ACTOR = "00000000-0000-4000-8000-000000000007"
const dialect = new PgDialect()
beforeEach(() => {
  vi.resetAllMocks()
  mocks.queries.length = 0
  mocks.failure = null
  mocks.rows.clear()
  mocks.rows.set(matches, [{ id: MATCH, tenantId: TENANT, teamAId: TEAM, teamBId: OPPONENT, tournamentId: TOURNAMENT }])
  mocks.rows.set(teams, [{ id: TEAM, name: "Historical side" }, { id: OPPONENT, name: "Opponent" }])
  mocks.rows.set(tournaments, [{ id: TOURNAMENT, name: "Competition" }])
  mocks.rows.set(matchInnings, [{ id: "innings", matchId: MATCH, tenantId: TENANT, teamId: TEAM }])
  mocks.rows.set(battingScorecards, [{ id: "bat", playerId: PLAYER, matchId: MATCH, teamId: TEAM }])
  mocks.rows.set(bowlingScorecards, [{ id: "bowl", playerId: PLAYER, matchId: MATCH, teamId: TEAM }])
  mocks.rows.set(fanFollows, [{ total: 2 }])
  mocks.select.mockImplementation(fields => {
    const record: any = { fields }
    mocks.queries.push(record)
    const chain: any = {
      from: (table: any) => { record.table = table; return chain },
      where: (where: any) => { Object.assign(record, dialect.sqlToQuery(where)); return chain },
      orderBy: (...order: any[]) => { record.orders = order.map(q => dialect.sqlToQuery(q)); return chain },
      then: (resolve: any, reject: any) => mocks.failure ? Promise.reject(mocks.failure).then(resolve, reject)
        : Promise.resolve(mocks.rows.get(record.table) ?? []).then(resolve, reject),
    }
    return chain
  })
})
describe("Authorized roster parent auxiliary reads (mocked SQL, not database execution)", () => {
  it("batches team fixture, opponent and innings queries without per-match lookups", async () => {
    const result = await readRosterTeamHistory(TENANT, TEAM)
    expect(result.fixtures).toHaveLength(1)
    expect(mocks.queries).toHaveLength(3)
    expect(mocks.queries[0].params).toEqual([TENANT, TEAM, TEAM])
    expect(mocks.queries[1].params).toEqual([TENANT, TEAM, OPPONENT])
    expect(mocks.queries[2].params).toEqual([TENANT, MATCH, TENANT])
    expect(mocks.queries[2].sql).toContain('"matches"."id" = "match_innings"."match_id"')
    expect(mocks.queries[2].sql).toContain('"match_innings"."team_id" = "matches"."team_a_id"')
    expect(mocks.queries[2].orders).toHaveLength(2)
  })
  it("does not generate empty IN queries when the team has no fixtures", async () => {
    mocks.rows.set(matches, [])
    await expect(readRosterTeamHistory(TENANT, TEAM)).resolves.toEqual({ fixtures: [], names: [], innings: [] })
    expect(mocks.queries).toHaveLength(1)
  })
  it("scopes each player's performance to league, match, innings and historical side", async () => {
    const result = await readRosterPlayerHistory(TENANT, PLAYER)
    expect(result.fixtures).toHaveLength(1)
    expect(mocks.queries).toHaveLength(5)
    for (const [index, table] of ["batting_scorecards", "bowling_scorecards"].entries()) {
      const query = mocks.queries[index]
      expect(query.params).toEqual([PLAYER, TENANT, TENANT, TENANT, TENANT])
      expect(query.sql).toContain('exists (SELECT 1 FROM "matches"')
      expect(query.sql).toContain(`"matches"."id" = "${table}"."match_id"`)
      expect(query.sql).toContain(`"match_innings"."id" = "${table}"."innings_id"`)
      expect(query.sql).toContain(`"match_innings"."match_id" = "${table}"."match_id"`)
      expect(query.sql).toContain(`"teams"."id" = "${table}"."team_id"`)
      expect(query.sql).toContain(`"${table}"."team_id" = "matches"."team_b_id"`)
      expect(query.sql).toMatch(/\)\)\)$/)
    }
    expect(mocks.queries[2].params).toEqual([TENANT, MATCH])
    expect(mocks.queries[3].params).toEqual([TENANT, TEAM, OPPONENT])
    expect(mocks.queries[4].params).toEqual([TENANT, TOURNAMENT])
  })
  it("does not use today's mutable team to filter historical performance", async () => {
    await readRosterPlayerHistory(TENANT, PLAYER)
    const query = mocks.queries[0]
    expect(query.sql).not.toContain('"players"."team_id"')
    expect(query.params).not.toContain(TEAM)
  })
  it("does not issue match/team/tournament reads when there is no performance", async () => {
    mocks.rows.set(battingScorecards, [])
    mocks.rows.set(bowlingScorecards, [])
    const result = await readRosterPlayerHistory(TENANT, PLAYER)
    expect(result.fixtures).toEqual([])
    expect(mocks.queries).toHaveLength(2)
  })
  it("does not issue empty tournament/name IN lookups after an unavailable fixture", async () => {
    mocks.rows.set(matches, [])
    await readRosterPlayerHistory(TENANT, PLAYER)
    expect(mocks.queries).toHaveLength(3)
  })
  it("correlates both follower count and current-user state to the same league/entity", async () => {
    await expect(readRosterFollowState(TENANT, ACTOR, "player", PLAYER)).resolves.toEqual({ following: true, followers: 2 })
    expect(mocks.queries[0].params).toEqual([TENANT, "player", PLAYER])
    expect(mocks.queries[1].params).toEqual([TENANT, "player", PLAYER, ACTOR])
  })
  it.each([() => readRosterTeamHistory(TENANT, TEAM), () => readRosterPlayerHistory(TENANT, PLAYER),
    () => readRosterFollowState(TENANT, ACTOR, "team", TEAM)])("propagates database failures instead of fake DNB/empty/count success", async read => {
    mocks.failure = new Error("Database unavailable")
    await expect(read()).rejects.toThrow("Database unavailable")
  })
})
describe("Historical player-side attribution", () => {
  it("uses the historical side regardless of later roster moves or unlinking", () => {
    expect(rosterHistoricalSide(MATCH, [{ matchId: MATCH, teamId: TEAM }, { matchId: MATCH, teamId: TEAM },
      { matchId: "other-match", teamId: OPPONENT }])).toBe(TEAM)
  })
  it("does not guess a side from missing performance", () => { expect(rosterHistoricalSide(MATCH, [])).toBeNull() })
  it("does not invent a winner/opponent when legacy performance sides conflict", () => {
    expect(rosterHistoricalSide(MATCH, [{ matchId: MATCH, teamId: TEAM }, { matchId: MATCH, teamId: OPPONENT }])).toBeNull()
  })
})
