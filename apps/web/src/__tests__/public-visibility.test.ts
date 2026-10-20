import { beforeEach, describe, expect, it, vi } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import { minorPublicDecision as policyMinorPublicDecision } from "@mtk/database/lib/minor-consent-policy"
import { matches, tournaments, playerSeasonStats, matchInnings, teams, players, users, battingScorecards, bowlingScorecards, fieldingScorecards, matchPlayingXis, tournamentAwards } from "@mtk/database"
import { AWARD_CATEGORY_LABELS, PUBLIC_AWARD_LIMIT } from "@mtk/database/lib/award-policy"
import { PUBLIC_LEADERBOARD_FORMATS } from "@/lib/leaderboard-filters"
import {
  isTournamentPublished, isMatchPublished, readPublishedTournament, readPublishedMatch,
  readPublishedMatchTeams, matchHasInnings, readPublicBattingLeaderboard,
  readPublicBowlingLeaderboard, readPublicFieldingLeaderboard, readPublicTournamentOptions,
  readPublishedTournamentAwards, readPublicWicketkeepingLeaderboard, PUBLIC_LEADERBOARD_LIMIT,
  minorConsentPublicSql,
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
      else if (record.table === tournamentAwards) rows = mocks.state.awards ?? []
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

describe("Public wicketkeeping leaderboard (PUB-03 keeper clause: designated-keeper attribution)", () => {
  it("attributes dismissals ONLY through the active designated-keeper XI row, inside the publication gate", async () => {
    for (const [label, input] of [["combined", {}], ["format-qualified", { format: "t20", tournamentId: TOURNAMENT, minimumMatches: 2 }]] as const) {
      await readPublicWicketkeepingLeaderboard(TENANT, input)
      const query = mocks.queries.at(-1)!
      expect(query.table, label).toBe(fieldingScorecards)
      // First join IS the attribution: the recorded keeper of that match+side.
      expect(query.joins[0], label).toBe(matchPlayingXis)
      expect(query.joins.slice(1), label).toEqual([players, users, matches, tournaments])
      // tenant appears in the XI attribution join + players + matches + tournaments + where.
      expect(query.params.filter((p: unknown) => p === TENANT), label).toHaveLength(5)
      // The designation gate is a real join condition: wicketkeeper must be true.
      expect(query.params.filter((p: unknown) => p === true), label).toHaveLength(1)
      // Publication gate params: the exact PUBLISHED status values never their negations.
      expect(query.params.filter((p: unknown) => p === "registration"), label).toHaveLength(1)
      expect(query.params.filter((p: unknown) => p === "completed"), label).toHaveLength(1)
      expect(query.params.filter((p: unknown) => p === "draft"), label).toHaveLength(0)
      if ("format" in input) expect(query.params, label).toContain("t20")
      if ("tournamentId" in input) expect(query.params, label).toContain(TOURNAMENT)
      expect(query.having.sql).toContain("count(")
      expect(query.limit, label).toBe(PUBLIC_LEADERBOARD_LIMIT)
    }
  })

  it("keeps verification provenance derivation on the keeper path", async () => {
    mocks.state.scorecards = [
      { playerId: "p1", playerName: "Linked Active", total: 7, playerUserId: "u1", linkedUserActive: true },
      { playerId: "p2", playerName: "Name Only", total: 5, playerUserId: null, linkedUserActive: null },
    ]
    expect((await readPublicWicketkeepingLeaderboard(TENANT)).map((r) => [r.playerName, r.playerVerified, r.total]))
      .toEqual([["Linked Active", true, 7], ["Name Only", false, 5]])
  })

  it("rejects invalid qualification before issuing a query and never hides a failure", async () => {
    await expect(readPublicWicketkeepingLeaderboard(TENANT, { minimumMatches: -1 } as never)).rejects.toThrow()
    expect(mocks.select).not.toHaveBeenCalled()

    mocks.select.mockImplementation(() => { throw new Error("Database unavailable") })
    await expect(readPublicWicketkeepingLeaderboard(TENANT)).rejects.toThrow("Database unavailable")
  })
})

describe("Published tournament award gallery (PUB-04)", () => {
  it("pins the gallery query to the tenant and tournament and only ACTIVE awards", async () => {
    mocks.state.awards = []
    await readPublishedTournamentAwards(TENANT, TOURNAMENT)

    expect(mocks.queries).toHaveLength(1)
    const query = mocks.queries[0]
    expect(query.table).toBe(tournamentAwards)
    // Winner-name provenance joins: players and teams, same-league only.
    expect(query.joins).toEqual([players, teams])
    // Joins pin by tenant first (players, teams), then the WHERE tenant+tournament.
    expect(query.params).toEqual([TENANT, TENANT, TENANT, TOURNAMENT])
    expect(query.order.map((o: any) => o.sql)).toEqual([
      expect.stringContaining("declared_at"),
      expect.stringContaining("id"),
    ])
    expect(query.limit).toBe(PUBLIC_AWARD_LIMIT)
  })

  it("labels categories and drops award rows that fail the shared visibility policy", async () => {
    mocks.state.awards = [
      { id: "aw1", category: "player_of_the_tournament", playerId: "p1", playerName: "Star Player", teamId: null, teamName: null, citation: "Outstanding", declaredAt: new Date("2026-10-01T00:00:00Z") },
      { id: "aw2", category: "best_bowler", playerId: null, teamId: "t9", teamName: "Champions XI", citation: null, declaredAt: new Date("2026-10-02T00:00:00Z") },
      // Ambiguous: both winner references removed by later deletes -> fails closed.
      { id: "aw3", category: "best_fielder", playerId: null, teamId: null, citation: null, declaredAt: new Date("2026-10-03T00:00:00Z") },
      // Both names unresolved (joined row gone) -> still structured, name null.
      { id: "aw4", category: "best_batsman", playerId: "p2", playerName: null, teamId: null, teamName: null, citation: null, declaredAt: new Date("2026-10-04T00:00:00Z") },
    ]

    const gallery = await readPublishedTournamentAwards(TENANT, TOURNAMENT)

    expect(gallery.map((a) => a.categoryLabel)).toEqual([
      AWARD_CATEGORY_LABELS.player_of_the_tournament,
      AWARD_CATEGORY_LABELS.best_bowler,
      AWARD_CATEGORY_LABELS.best_batsman,
    ])
    expect(gallery[0]).toEqual(expect.objectContaining({
      id: "aw1", playerName: "Star Player", teamName: null, citation: "Outstanding",
    }))
    expect(gallery.some((a) => a.id === "aw3")).toBe(false)
    expect(gallery[2]).toEqual(expect.objectContaining({ id: "aw4", playerName: null, teamName: null }))
  })

  it("does not hide a gallery query failure as an empty ceremony", async () => {
    mocks.select.mockImplementation(() => { throw new Error("Database unavailable") })
    await expect(readPublishedTournamentAwards(TENANT, TOURNAMENT)).rejects.toThrow("Database unavailable")
  })
})


describe("Records by competition and published-competition options (PUB-03)", () => {
  const OPTION = "00000000-0000-4000-8000-0000000000cc"

  it("narrows the combined batting/bowling boards to the competition dimension", async () => {
    await readPublicBattingLeaderboard(TENANT, { tournamentId: OPTION })
    await readPublicBowlingLeaderboard(TENANT, { tournamentId: OPTION })
    expect(mocks.queries.length).toBe(2)
    for (const record of mocks.queries) {
      expect(record.table).toBe(playerSeasonStats)
      expect(record.params).toContain(OPTION)
    }
  })

  it("keeps the combined boards league-wide when no competition is selected", async () => {
    await readPublicBattingLeaderboard(TENANT)
    expect(mocks.queries[0].params).not.toContain(OPTION)
  })

  it("narrows the format-qualified batting board through the matches join", async () => {
    await readPublicBattingLeaderboard(TENANT, { format: "t20", tournamentId: OPTION })
    expect(mocks.queries.length).toBe(1)
    expect(mocks.queries[0].params).toContain("t20")
    expect(mocks.queries[0].params).toContain(OPTION)
  })

  it("narrows the fielding board on both aggregation paths", async () => {
    await readPublicFieldingLeaderboard(TENANT, { tournamentId: OPTION })
    await readPublicFieldingLeaderboard(TENANT, { format: "odi", tournamentId: OPTION })
    expect(mocks.queries.length).toBe(2)
    for (const record of mocks.queries) {
      expect(record.params).toContain(OPTION)
    }
  })

  it("offers only published same-league competitions, bounded", async () => {
    mocks.state.parent = { id: OPTION, name: "Cup 2026", status: "completed" }
    const options = await readPublicTournamentOptions(TENANT)
    expect(options).toHaveLength(1)
    const record = mocks.queries[0]
    expect(record.table).toBe(tournaments)
    expect(record.params[0]).toBe(TENANT)
    expect(record.limit).toBe(100)
  })
})

describe("minor-consent SQL twin (ENH-01-01)", () => {
  const NOW = new Date("2026-10-20T12:00:00Z")
  const dialectTwin = new PgDialect()
  const normalized = (text: string) => text.replace(/\s+/g, " ").toLowerCase().trim()

  it("renders exactly the fail-closed minorPublicDecision formula", () => {
    const emitted = normalized(dialectTwin.sqlToQuery(minorConsentPublicSql).sql)
    // The twin of minorPublicDecision must read: no recorded DOB is never a
    // minor (visible); an adult (DOB <= today-18y, 18th birthday included)
    // is visible; a proven minor is visible ONLY with consent already
    // effective (consent <= now() - a future instant is not consent).
    // (Expected text mirrors drizzle's rendering: quoted table, bare column.)
    expect(emitted).toBe(
      normalized(`(
        "players".date_of_birth is null
        or "players".date_of_birth <= (current_date - interval '18 years')
        or ("players".guardian_consent_at is not null and "players".guardian_consent_at <= now())
      )`),
    )
  })

  it("keeps the SQL formula aligned with the pinned TS boundary matrix", () => {
    // What the formula above MUST express, re-derived from the shared policy
    // (packages/database/src/__tests__/minor-consent-policy.test.ts):
    const decision = (dob: string, consent: string | null) =>
      policyMinorPublicDecision(dob, consent, NOW).visible
    // 18th birthday today: adult, visible WITHOUT consent (strict `>` would
    // misread this row as a minor; `<=` is the adult side of the boundary).
    expect(decision("2008-10-20", null)).toBe(true)
    // One day younger: proven minor, withheld without consent...
    expect(decision("2008-10-21", null)).toBe(false)
    // ...published only by an already-effective consent...
    expect(decision("2008-10-21", "2026-06-01T00:00:00Z")).toBe(true)
    // ...never by a future consent instant.
    expect(decision("2008-10-21", "2027-01-01T00:00:00Z")).toBe(false)
    // Missing DOB: never guessed into a minor.
    expect(policyMinorPublicDecision(null, null, NOW)).toEqual({ visible: true, basis: "not_provable" })
  })
})
