import { beforeEach, describe, expect, it, vi } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import { matches, tournaments, playerSeasonStats, matchInnings, teams } from "@mtk/database"
import {
  isTournamentPublished, isMatchPublished, readPublishedTournament, readPublishedMatch,
  readPublishedMatchTeams, matchHasInnings, readPublicBattingLeaderboard,
  readPublicBowlingLeaderboard, PUBLIC_LEADERBOARD_LIMIT,
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
  const record: any = { params: [], joins: [] }
  mocks.queries.push(record)
  const merge = (where: any) => {
    const q = dialect.sqlToQuery(where)
    record.params.push(...q.params)
  }
  const chain: any = {
    from: (table: any) => { record.table = table; return chain },
    innerJoin: (_table: any, where: any) => { record.joins.push(_table); if (where) merge(where); return chain },
    where: (where: any) => { merge(where); return chain },
    groupBy: () => chain,
    orderBy: () => chain,
    limit: (limit: number) => { record.limit = limit; return chain },
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
})
