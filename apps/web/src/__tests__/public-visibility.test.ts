import { beforeEach, describe, expect, it, vi } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import { matches, tournaments, playerSeasonStats, matchInnings, teams, players, users, battingScorecards, bowlingScorecards, fieldingScorecards } from "@mtk/database"
import { PUBLIC_LEADERBOARD_FORMATS } from "@/lib/leaderboard-filters"
import {
  isTournamentPublished, isMatchPublished, readPublishedTournament, readPublishedMatch,
  readPublishedMatchTeams, matchHasInnings, readPublicBattingLeaderboard,
  readPublicBowlingLeaderboard, readPublicFieldingLeaderboard, PUBLIC_LEADERBOARD_LIMIT,
} from "@/lib/public-visibility"

const mocks = vi.hoisted(() => ({ select: vi.fn(), queries: [] as any[], state: {} as any }))
vi.mock("@mtk/database", async (original) => ({
  ...await original<typeof import("@mtk/database")>(), db: { select: mocks.select },
}))

const TENANT = "00000000-0000-4000-8000-000000000001"
const MATCH = "00000000-0000-4000-8000-0000000000aa"
const TOURNAMENT = "00000000-0000-4000-8000-0000000000bb"
const dialect = new PgDialect()

function selectChain() {
  const record: any = { params: [], joins: [], steps: [] }
  mocks.queries.push(record)
  const merge = (where: any) => {
    const q = dialect.sqlToQuery(where)
    record.params.push(...q.params)
  }
  const chain: any = {
    from: (table: any) => { record.table = table; return chain },
    innerJoin: (_table: any, where: any) => { record.joins.push(_table); if (where) merge(where); return chain },
    // Verification provenance join (PUB-03): must never drop a name-only roster row.
    leftJoin: (_table: any, where: any) => { record.joins.push(_table); if (where) merge(where); return chain },
    where: (where: any) => { merge(where); return chain },
    groupBy: () => { record.steps.push("groupBy"); return chain },
    having: (where: any) => { record.steps.push("having"); record.having = dialect.sqlToQuery(where); return chain },
    orderBy: (...order: any[]) => { record.steps.push("orderBy"); record.order = order.map(value => dialect.sqlToQuery(value)); return chain },
    limit: (limit: number) => { record.steps.push("limit"); record.limit = limit; return chain },
    then: (resolve: any, reject: any) => {
      let rows: any[] = []
      if (record.table === matches) rows = mocks.state.match ? [mocks.state.match] : []
      else if (record.table === tournaments) rows = mocks.state.parent ? [mocks.state.parent] : []
      else if (record.table === teams) {
        // Return only the team whose id matches the first where param (a/b).
        const wanted = record.params[0]
        rows = (mocks.state.teams ?? []).filter((t: any) => t.id === wanted)
      } else if (record.table === matchInnings) rows = mocks.state.innings ?? []
      else if (record.table === playerSeasonStats) rows = mocks.state.leaderboard ?? []
      else if (record.table === fieldingScorecards || record.table === battingScorecards || record.table === bowlingScorecards) rows = mocks.state.scorecards ?? []
      return Promise.resolve(rows).then(resolve, reject)
    },
  }
  return chain
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.queries.length = 0
  mocks.state = {
    match: { id: MATCH, tenantId: TENANT, status: "live", tournamentId: TOURNAMENT, teamAId: "a", teamBId: "b" },
    parent: { status: "live" }, teams: [{ id: "a" }, { id: "b" }], innings: [], leaderboard: [],
  }
  mocks.select.mockImplementation(selectChain)
})

describe("Publication predicates (pure)", () => {
  it.each(["registration", "live", "completed"])("publishes tournament status %s", (s) => {
    expect(isTournamentPublished(s)).toBe(true)
  })
  it.each(["draft", "cancelled", null, undefined, ""])("hides tournament status %s", (s) => {
    expect(isTournamentPublished(s as any)).toBe(false)
  })
  it.each(["scheduled", "toss", "live", "innings_break", "completed", "abandoned", "no_result"])
    ("publishes match status %s", (s) => expect(isMatchPublished(s)).toBe(true))
  it.each(["cancelled", null, undefined])("hides match status %s", (s) => {
    expect(isMatchPublished(s as any)).toBe(false)
  })
})

describe("Public reads are tenant-scoped and publication-gated", () => {
  it("returns a published tournament and rejects a draft one", async () => {
    mocks.state.parent = { status: "live" }
    expect((await readPublishedTournament(TENANT, TOURNAMENT))?.status).toBe("live")
    // readPublishedTournament reads from tournaments table
    expect(mocks.queries[0].table).toBe(tournaments)
    expect(mocks.queries[0].params).toEqual([TOURNAMENT, TENANT])
  })

  it("returns a published match and checks the same-league parent tournament", async () => {
    const row = await readPublishedMatch(TENANT, MATCH)
    expect(row?.id).toBe(MATCH)
    expect(mocks.queries[0].table).toBe(matches)
    expect(mocks.queries[0].params).toEqual([MATCH, TENANT])
    expect(mocks.queries[1].table).toBe(tournaments)
    expect(mocks.queries[1].params).toEqual([TOURNAMENT, TENANT])
  })

  it("hides a cancelled match before consulting its tournament", async () => {
    mocks.state.match = { ...mocks.state.match, status: "cancelled" }
    expect(await readPublishedMatch(TENANT, MATCH)).toBeNull()
    expect(mocks.queries).toHaveLength(1)
  })

  it("hides a match whose parent tournament is a draft or missing", async () => {
    mocks.state.parent = { status: "draft" }
    expect(await readPublishedMatch(TENANT, MATCH)).toBeNull()
    mocks.state.parent = null
    expect(await readPublishedMatch(TENANT, MATCH)).toBeNull()
  })

  it("lets a tournament-less friendly follow its own published status", async () => {
    mocks.state.match = { ...mocks.state.match, tournamentId: null }
    expect((await readPublishedMatch(TENANT, MATCH))?.id).toBe(MATCH)
    expect(mocks.queries).toHaveLength(1)
  })

  it("returns same-league teams and reports innings presence", async () => {
    const { teamA, teamB } = await readPublishedMatchTeams(TENANT, mocks.state.match)
    expect(teamA?.id).toBe("a")
    expect(teamB?.id).toBe("b")
    expect(await matchHasInnings(TENANT, MATCH)).toBe(false)
    mocks.state.innings = [{ id: "i1" }]
    expect(await matchHasInnings(TENANT, MATCH)).toBe(true)
  })

  it.each([[readPublicBattingLeaderboard], [readPublicBowlingLeaderboard]])(
    "scopes and publication-gates the public leaderboard", async (read) => {
      await read(TENANT)
      const query = mocks.queries[0]
      expect(query.table).toBe(playerSeasonStats)
      // tenant predicate on stats and both joined tables
      expect(query.params.filter((p: unknown) => p === TENANT)).toHaveLength(3)
      expect(query.params).toContain("registration")
      expect(query.params).toContain("completed")
      expect(query.params).not.toContain("draft")
      expect(query.params).not.toContain("cancelled")
      expect(query.limit).toBe(PUBLIC_LEADERBOARD_LIMIT)
    })

  it.each([
    ["batting", readPublicBattingLeaderboard, "innings_batted", "balls_faced"],
    ["bowling", readPublicBowlingLeaderboard, "innings_bowled", "balls_bowled"],
  ] as const)("qualifies the %s aggregate before ranking and limiting", async (_name, read, innings, balls) => {
    await read(TENANT, { minimumInnings: 3, minimumBalls: 60 })
    const query = mocks.queries[0]
    expect(query.having.sql).toContain(`sum("player_season_stats"."${innings}")`)
    expect(query.having.sql).toContain(`sum("player_season_stats"."${balls}")`)
    expect(query.having.params).toEqual([3, 60])
    expect(query.steps).toEqual(["groupBy", "having", "orderBy", "limit"])
    expect(query.order[1].sql).toContain('"player_season_stats"."player_id" asc')
    expect(query.limit).toBe(PUBLIC_LEADERBOARD_LIMIT)
  })

  it("retains no-minimum qualification by default", async () => {
    await readPublicBattingLeaderboard(TENANT)
    expect(mocks.queries[0].having.params).toEqual([0, 0])
  })

  it.each([[readPublicBattingLeaderboard, battingScorecards, "batting"], [readPublicBowlingLeaderboard, bowlingScorecards, "bowling"]] as const)(
    "switches the %s ranking to per-innings base rows filtered on the match's declared format", async (read, rowsTable, _name) => {
      await read(TENANT, { minimumInnings: 3, minimumBalls: 60, format: "t20" })
      const query = mocks.queries[0]
      expect(query.table).toBe(rowsTable)
      // match -> published same-league tournament join, format pinned on the match.
      // users is a LEFT join (verification provenance): a name-only roster row survives it.
      expect(query.joins).toEqual([players, users, matchInnings, matches, tournaments])
      // The declared format is a bound parameter of the same-league, published predicate.
      expect(query.params).toContain("t20")
      expect(query.params.filter((p: unknown) => p === TENANT)).toHaveLength(5)
      expect(query.params).toContain("registration")
      expect(query.params).toContain("completed")
      expect(query.params).not.toContain("draft")
      expect(query.having.sql).toContain("count(")
      expect(query.having.sql).toContain(rowsTable === battingScorecards ? 'sum("batting_scorecards"."balls_faced")' : 'sum("bowling_scorecards"."balls_bowled")')
      expect(query.having.params).toEqual([3, 60])
      expect(query.limit).toBe(PUBLIC_LEADERBOARD_LIMIT)
      // Every canonical format value is accepted by the reader tier.
      for (const f of PUBLIC_LEADERBOARD_FORMATS) {
        await read(TENANT, { format: f })
        expect(mocks.queries.at(-1)!.params).toContain(f)
      }
    })

  it("keeps the combined season aggregates untouched when no format is selected", async () => {
    await readPublicBattingLeaderboard(TENANT, { minimumInnings: 1, minimumBalls: 6 })
    const query = mocks.queries[0]
    expect(query.table).toBe(playerSeasonStats)
    // users is a LEFT join (verification provenance): a name-only roster row survives it.
    expect(query.joins).toEqual([players, users, tournaments])
  })

  it("marks rows verified only for an active linked account, in both aggregation paths (PUB-03)", async () => {
    const provenance = [
      { playerId: "p1", playerName: "Linked Active", total: 40, playerUserId: "u1", linkedUserActive: true },
      { playerId: "p2", playerName: "Linked Suspended", total: 35, playerUserId: "u2", linkedUserActive: false },
      { playerId: "p3", playerName: "Name Only", total: 30, playerUserId: null, linkedUserActive: null },
    ]
    const expected = [
      ["Linked Active", true],
      ["Linked Suspended", false],
      ["Name Only", false],
    ]
    mocks.state.leaderboard = provenance
    expect((await readPublicBattingLeaderboard(TENANT)).map((r) => [r.playerName, r.playerVerified]))
      .toEqual(expected)
    mocks.state.leaderboard = []
    mocks.state.scorecards = provenance
    expect((await readPublicBowlingLeaderboard(TENANT, { format: "t20" })).map((r) => [r.playerName, r.playerVerified]))
      .toEqual(expected)
  })

  it.each([
    { minimumInnings: -1 }, { minimumInnings: 0.5 }, { minimumBalls: 10_001 },
    { minimumBalls: NaN }, { minimumBalls: Infinity }, { minimumBalls: "60" },
    { unknownFilter: true },
  ])("rejects invalid qualification %s before issuing a query", async input => {
    await expect(readPublicBattingLeaderboard(TENANT, input as never)).rejects.toThrow()
    await expect(readPublicBowlingLeaderboard(TENANT, input as never)).rejects.toThrow()
    expect(mocks.select).not.toHaveBeenCalled()
  })

  it("does not hide a leaderboard query failure as an empty ranking", async () => {
    mocks.select.mockImplementation(() => { throw new Error("Database unavailable") })
    await expect(readPublicBattingLeaderboard(TENANT, { minimumInnings: 1 })).rejects.toThrow("Database unavailable")
  })
})

describe("Public fielding leaderboard (PUB-03 remainder: matches-based qualification)", () => {
  it("aggregates combined-season dismissals under the same publication boundary", async () => {
    await readPublicFieldingLeaderboard(TENANT, { minimumMatches: 2 })
    const query = mocks.queries[0]
    expect(query.table).toBe(playerSeasonStats)
    expect(query.params.filter((p: unknown) => p === TENANT)).toHaveLength(3)
    expect(query.params).toContain("registration")
    expect(query.params).toContain("completed")
    expect(query.params).not.toContain("draft")
    expect(query.params).not.toContain("cancelled")
    // Qualification for fielding is matches played — never innings or balls.
    expect(query.having.sql).toContain('sum("player_season_stats"."matches_played")')
    expect(query.having.params).toEqual([2])
    expect(query.having.sql).not.toContain("balls")
    expect(query.limit).toBe(PUBLIC_LEADERBOARD_LIMIT)
    expect(query.order[1].sql).toContain('"player_season_stats"."player_id" asc')
  })

  it("ranks format-qualified fielding from per-match scorecards through the declared format", async () => {
    for (const f of PUBLIC_LEADERBOARD_FORMATS) {
      await readPublicFieldingLeaderboard(TENANT, { minimumMatches: 3, minimumInnings: 5, minimumBalls: 60, format: f })
      const query = mocks.queries.at(-1)!
      expect(query.table).toBe(fieldingScorecards)
      // fielding_scorecards is per-MATCH: match -> published tournament, no innings join exists.
      expect(query.joins).toEqual([players, users, matches, tournaments])
      expect(query.params).toContain(f)
      expect(query.params.filter((p: unknown) => p === TENANT)).toHaveLength(4)
      expect(query.params).toContain("registration")
      expect(query.params).toContain("completed")
      expect(query.params).not.toContain("draft")
      expect(query.having.sql).toContain("count(")
      expect(query.having.sql).not.toContain("balls")
      expect(query.having.sql).not.toContain("innings")
      expect(query.limit).toBe(PUBLIC_LEADERBOARD_LIMIT)
    }
  })

  it("defaults fielding qualification to zero matches", async () => {
    await readPublicFieldingLeaderboard(TENANT)
    expect(mocks.queries[0].having.params).toEqual([0])
  })

  it("keeps the verification provenance derivation on both fielding aggregation paths", async () => {
    const provenance = [
      { playerId: "p1", playerName: "Linked Active", total: 12, playerUserId: "u1", linkedUserActive: true },
      { playerId: "p2", playerName: "Linked Suspended", total: 11, playerUserId: "u2", linkedUserActive: false },
      { playerId: "p3", playerName: "Name Only", total: 9, playerUserId: null, linkedUserActive: null },
    ]
    const expected = [
      ["Linked Active", true],
      ["Linked Suspended", false],
      ["Name Only", false],
    ]
    mocks.state.leaderboard = provenance
    expect((await readPublicFieldingLeaderboard(TENANT)).map((r) => [r.playerName, r.playerVerified]))
      .toEqual(expected)
    mocks.state.leaderboard = []
    mocks.state.scorecards = provenance
    expect((await readPublicFieldingLeaderboard(TENANT, { format: "t20" })).map((r) => [r.playerName, r.playerVerified]))
      .toEqual(expected)
  })

  it.each([
    { minimumMatches: -1 }, { minimumMatches: 0.5 }, { minimumMatches: 10_001 },
    { minimumMatches: "3" }, { format: "t10", minimumMatches: NaN }, { unknownFilter: true },
  ])("rejects invalid fielding qualification %p before issuing a query", async input => {
    await expect(readPublicFieldingLeaderboard(TENANT, input as never)).rejects.toThrow()
    expect(mocks.select).not.toHaveBeenCalled()
  })

  it("does not hide a fielding query failure as an empty ranking", async () => {
    mocks.select.mockImplementation(() => { throw new Error("Database unavailable") })
    await expect(readPublicFieldingLeaderboard(TENANT)).rejects.toThrow("Database unavailable")
  })
})
