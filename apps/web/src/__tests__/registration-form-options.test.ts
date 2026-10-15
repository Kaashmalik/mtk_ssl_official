import { beforeEach, describe, expect, it, vi } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import { teams, tournaments, players } from "@mtk/database"
import { readRegistrationFormOptions } from "@/lib/registration-reads"

const mocks = vi.hoisted(() => ({ select: vi.fn(), queries: [] as any[], state: {} as any }))
vi.mock("@mtk/database", async (original) => ({
  ...await original<typeof import("@mtk/database")>(), db: { select: mocks.select },
}))

const TENANT = "00000000-0000-4000-8000-000000000001"
const OTHER_TENANT = "00000000-0000-4000-8000-0000000000ff"
const dialect = new PgDialect()

function rowsFor(record: any) {
  if (record.table === teams) return mocks.state.teams
  if (record.table === tournaments) return mocks.state.tournaments
  if (record.table === players) return mocks.state.players
  return []
}

function selectChain() {
  const record: any = { params: [] }
  mocks.queries.push(record)
  const chain: any = {
    from: (table: any) => { record.table = table; return chain },
    where: (where: any) => { record.params = dialect.sqlToQuery(where).params; return chain },
    orderBy: () => chain,
    limit: (limit: number) => { record.limit = limit; return chain },
    then: (resolve: any, reject: any) => Promise.resolve(rowsFor(record)).then(resolve, reject),
  }
  return chain
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.queries.length = 0
  mocks.state = {
    teams: [{ id: "t1", name: "Falcons" }],
    tournaments: [{ id: "c1", name: "Cup", registrationOpen: true }],
    players: [{ id: "p1", name: "Ali", teamId: "t1" }],
  }
  mocks.select.mockImplementation(selectChain)
})

describe("Registration form pickers are scoped and bounded", () => {
  it("predicates every picker on the active league and never another league", async () => {
    const result = await readRegistrationFormOptions(TENANT)
    expect(mocks.queries.length).toBe(3)
    for (const query of mocks.queries) {
      expect(query.params).toContain(TENANT)
      expect(query.params).not.toContain(OTHER_TENANT)
    }
    expect(result).toEqual({
      teams: [{ id: "t1", name: "Falcons" }],
      tournaments: [{ id: "c1", name: "Cup", registrationOpen: true }],
      players: [{ id: "p1", name: "Ali", teamId: "t1" }],
    })
  })

  it("narrows teams to active teams only and over-fetches each picker by one row", async () => {
    await readRegistrationFormOptions(TENANT)
    const teamQuery = mocks.queries.find((query) => query.table === teams)!
    expect(teamQuery.params).toEqual([TENANT, true])
    expect(teamQuery.limit).toBe(101)
    expect(mocks.queries.find((query) => query.table === tournaments)!.limit).toBe(101)
    expect(mocks.queries.find((query) => query.table === players)!.limit).toBe(201)
  })

  it("truncates an over-fetched picker to the bound", async () => {
    mocks.state.teams = Array.from({ length: 101 }, (_, index) => ({ id: `t${index}`, name: `Team ${index}` }))
    const result = await readRegistrationFormOptions(TENANT)
    expect(result.teams).toHaveLength(100)
  })
})
