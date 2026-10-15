import { beforeEach, describe, expect, it, vi } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import { teams, matches, tournaments } from "@mtk/database"
import { readTournamentList, tournamentListLimit } from "@/lib/tournament-reads"

const mocks = vi.hoisted(() => ({
  select: vi.fn(), queries: [] as any[], state: {} as any,
}))
vi.mock("@mtk/database", async (original) => ({ ...await original<typeof import("@mtk/database")>(), db: { select: mocks.select } }))

const TENANT = "00000000-0000-4000-8000-000000000001"
const TOURNAMENT = "00000000-0000-4000-8000-000000000002"
const dialect = new PgDialect()

function rowsFor(record: any) {
  if (record.table === tournaments) return mocks.state.tournaments
  if (record.table === teams) return mocks.state.teamCounts
  if (record.table === matches) return record.params?.includes("completed") ? mocks.state.completedCounts : mocks.state.matchCounts
  return []
}

function selectChain() {
  const record: any = { params: [] }
  mocks.queries.push(record)
  const chain: any = {
    from: (table: any) => { record.table = table; return chain },
    where: (where: any) => { record.params = dialect.sqlToQuery(where).params; return chain },
    groupBy: () => chain,
    orderBy: (...order: any[]) => { record.orders = order.map((entry: any) => dialect.sqlToQuery(entry)); return chain },
    limit: (limit: number) => { record.limit = limit; return chain },
    then: (resolve: any, reject: any) => Promise.resolve(rowsFor(record)).then(resolve, reject),
  }
  return chain
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.queries.length = 0
  mocks.state = {
    tournaments: [{ id: TOURNAMENT, tenantId: TENANT, name: "League", status: "registration" }],
    teamCounts: [{ tournamentId: TOURNAMENT, total: 4 }],
    matchCounts: [{ tournamentId: TOURNAMENT, total: 6 }],
    completedCounts: [{ tournamentId: TOURNAMENT, total: 3 }],
  }
  mocks.select.mockImplementation(selectChain)
})

describe("Tournament list reads are league-scoped and bounded", () => {
  it("aggregates team and match counts inside the active league", async () => {
    const result = await readTournamentList(TENANT)
    expect(result.truncated).toBe(false)
    expect(result.tournaments).toEqual([
      { id: TOURNAMENT, tenantId: TENANT, name: "League", status: "registration",
        registeredTeams: 4, totalMatches: 6, completedMatches: 3 },
    ])
  })
  it("scopes the list and every child count with the active-league predicate", async () => {
    await readTournamentList(TENANT)
    const list = mocks.queries.find((query) => query.table === tournaments)!
    expect(list.params).toEqual([TENANT])
    expect(list.limit).toBe(tournamentListLimit + 1)
    for (const table of [teams, matches]) {
      for (const query of mocks.queries.filter((entry) => entry.table === table)) {
        expect(query.params).toContain(TENANT)
        expect(query.params).toContain(TOURNAMENT)
      }
    }
    const completed = mocks.queries.filter((query) => query.table === matches && query.params.includes("completed"))
    expect(completed).toHaveLength(1)
  })
  it("reports zero counts for a tournament with no teams or matches", async () => {
    mocks.state.teamCounts = []
    mocks.state.matchCounts = []
    mocks.state.completedCounts = []
    const result = await readTournamentList(TENANT)
    expect(result.tournaments[0]).toMatchObject({ registeredTeams: 0, totalMatches: 0, completedMatches: 0 })
  })
  it("flags truncation beyond the list bound and skips child counts when empty", async () => {
    const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
    mocks.state.tournaments = Array.from({ length: tournamentListLimit + 1 }, (_, index) => ({
      id: id(index), tenantId: TENANT, name: `T${index}`,
    }))
    const result = await readTournamentList(TENANT)
    expect(result.truncated).toBe(true)
    expect(result.tournaments).toHaveLength(tournamentListLimit)
    mocks.queries.length = 0
    mocks.state.tournaments = []
    await expect(readTournamentList(TENANT)).resolves.toEqual({ truncated: false, tournaments: [] })
    expect(mocks.queries).toHaveLength(1)
    expect(mocks.queries[0].table).toBe(tournaments)
  })
})
