import { beforeEach, describe, expect, it, vi } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import { venues } from "@mtk/database"
import { readVenue, readVenueList, readVenueOptions, venueListLimit } from "@/lib/venue-reads"

const mocks = vi.hoisted(() => ({ select: vi.fn(), queries: [] as any[], state: {} as any }))
vi.mock("@mtk/database", async (original) => ({
  ...await original<typeof import("@mtk/database")>(), db: { select: mocks.select },
}))

const TENANT = "00000000-0000-4000-8000-000000000001"
const OTHER_TENANT = "00000000-0000-4000-8000-0000000000ff"
const VENUE = "00000000-0000-4000-8000-000000000002"
const dialect = new PgDialect()

function selectChain() {
  const record: any = { params: [] }
  mocks.queries.push(record)
  const chain: any = {
    from: (table: any) => { record.table = table; return chain },
    where: (where: any) => { record.params = dialect.sqlToQuery(where).params; return chain },
    orderBy: () => chain,
    limit: (limit: number) => { record.limit = limit; return chain },
    then: (resolve: any, reject: any) => Promise.resolve(mocks.state.venues).then(resolve, reject),
  }
  return chain
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.queries.length = 0
  mocks.state = { venues: [{ id: VENUE, name: "Gaddafi Stadium", city: "Lahore", isActive: true }] }
  mocks.select.mockImplementation(selectChain)
})

describe("Venue reads are scoped to the exact active league and bounded", () => {
  it("predicates the venue list on the active league and never another league", async () => {
    const result = await readVenueList(TENANT)
    expect(mocks.queries).toHaveLength(1)
    expect(mocks.queries[0].table).toBe(venues)
    expect(mocks.queries[0].params).toContain(TENANT)
    expect(mocks.queries[0].params).not.toContain(OTHER_TENANT)
    expect(mocks.queries[0].limit).toBe(venueListLimit + 1)
    expect(result.truncated).toBe(false)
    expect(result.venues).toHaveLength(1)
  })

  it("bounds the list and reports truncation", async () => {
    mocks.state.venues = Array.from({ length: venueListLimit + 1 }, (_, index) => ({ id: `v${index}`, name: `Venue ${index}` }))
    const result = await readVenueList(TENANT)
    expect(result.truncated).toBe(true)
    expect(result.venues).toHaveLength(venueListLimit)
  })

  it("scopes a single venue read to the active league", async () => {
    const result = await readVenue(TENANT, VENUE)
    expect(mocks.queries[0].params).toEqual([VENUE, TENANT])
    expect(result?.id).toBe(VENUE)
  })

  it("narrows the picker to active venues and truncates to the bound", async () => {
    mocks.state.venues = Array.from({ length: 201 }, (_, index) => ({ id: `v${index}`, name: `Venue ${index}`, city: null }))
    const result = await readVenueOptions(TENANT)
    expect(mocks.queries[0].params).toEqual([TENANT, true])
    expect(mocks.queries[0].limit).toBe(201)
    expect(result).toHaveLength(200)
  })
})
