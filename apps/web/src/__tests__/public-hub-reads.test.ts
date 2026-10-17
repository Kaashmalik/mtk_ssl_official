import { beforeEach, describe, expect, it, vi } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import { tenants, db } from "@mtk/database"
import { PUBLIC_HUB_LEAGUE_LIMIT, hubLeagueUrl, readListedHubLeagues } from "@/lib/public-hub"

// Only the db handle is mocked; real schema tables and the real PUB-02 listing
// policy and publication predicates pass through.
vi.mock("@mtk/database", async (importOriginal) => ({
  ...await importOriginal<typeof import("@mtk/database")>(),
  db: { select: vi.fn() },
}))

const LISTED_AT = new Date("2026-10-17T00:00:00Z")
const dialect = new PgDialect()
const LISTED_ROWS = [
  { tenantId: "00000000-0000-4000-8000-0000000000c1", name: "Alpha League", slug: "alpha",
    customDomain: "play.alpha.com", customDomainVerified: true, sslEnabled: true, hubListedAt: LISTED_AT },
  { tenantId: "00000000-0000-4000-8000-0000000000c2", name: "Beta League", slug: "beta",
    customDomain: null, customDomainVerified: false, sslEnabled: false, hubListedAt: LISTED_AT },
]

/**
 * Queues the three selects in order: listed leagues, published competition
 * counts, live match counts. The first query's shape is captured; the two
 * aggregate chains record their predicate params separately in call order.
 */
function queueSelects(leagueRows: unknown[], competitionRows: unknown[] = [], liveRows: unknown[] = [], record?: any) {
  const select = vi.fn()
    .mockImplementationOnce(() => {
      const chain: any = {
        from: (table: any) => { if (record) record.table = table; return chain },
        where: (where: any) => { if (record) record.params.push(...dialect.sqlToQuery(where).params); return chain },
        orderBy: (order?: any) => {
          if (record && order) record.orderBy = (Array.isArray(order) ? order : [order]).map((o: any) => dialect.sqlToQuery(o).sql)
          return chain
        },
        limit: (value: number) => {
          if (record) record.limit = value
          return { then: (resolve: any) => Promise.resolve(leagueRows).then(resolve) }
        },
      }
      return chain
    })
  for (const aggregateRows of [competitionRows, liveRows]) {
    select.mockImplementationOnce(() => {
      const chain: any = {
        from: () => chain,
        leftJoin: (_t: any, where?: any) => {
          if (record?.aggregate) record.aggregate.joinParams.push(...dialect.sqlToQuery(where).params)
          return chain
        },
        where: (where: any) => {
          if (record?.aggregate) record.aggregate.params.push(...dialect.sqlToQuery(where).params)
          return chain
        },
        groupBy: () => chain,
        then: (resolve: any) => Promise.resolve(aggregateRows).then(resolve),
      }
      return chain
    })
  }
  ;(db as any).select = select
  return select
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe("Listed hub league read models (the only cross-tenant public read)", () => {
  it("maps listed leagues with verified-domain links and publish-gated counts", async () => {
    queueSelects(LISTED_ROWS,
      [{ tenantId: "00000000-0000-4000-8000-0000000000c1", competitions: 3 }],
      [{ tenantId: "00000000-0000-4000-8000-0000000000c1", live: 1 }])

    const read = await readListedHubLeagues()

    expect(read.complete).toBe(true)
    expect(read.limit).toBe(PUBLIC_HUB_LEAGUE_LIMIT)
    expect(read.leagues).toEqual([
      expect.objectContaining({
        tenantId: "00000000-0000-4000-8000-0000000000c1", name: "Alpha League", slug: "alpha",
        url: "https://play.alpha.com", publishedCompetitions: 3, liveMatches: 1, listedAt: LISTED_AT,
      }),
      expect.objectContaining({
        name: "Beta League", url: null, publishedCompetitions: 0, liveMatches: 0,
      }),
    ])
  })

  it("reports incompleteness when more eligible leagues exist beyond the bound", async () => {
    const overflow = Array.from({ length: PUBLIC_HUB_LEAGUE_LIMIT + 1 }, (_, i) => ({
      tenantId: `00000000-0000-4000-8009-${String(i).padStart(12, "0")}`, name: `League ${i}`, slug: `l${i}`,
      customDomain: null, customDomainVerified: false, sslEnabled: false, hubListedAt: LISTED_AT,
    }))
    queueSelects(overflow)

    const read = await readListedHubLeagues()

    expect(read.leagues).toHaveLength(PUBLIC_HUB_LEAGUE_LIMIT)
    expect(read.complete).toBe(false)
  })

  it("resolves an inconsistent listed-without-timestamp row through the shared policy (never rendered)", async () => {
    queueSelects([{ ...LISTED_ROWS[0], hubListedAt: null }])

    const read = await readListedHubLeagues()

    expect(read.leagues).toEqual([])
    expect(read.complete).toBe(true)
  })

  it("issues no aggregate queries when nothing is listed", async () => {
    const select = queueSelects([])

    await readListedHubLeagues()

    expect(select).toHaveBeenCalledTimes(1)
  })
})

describe("Hub league query shape", () => {
  it("filters leagues in SQL on listing, activation and provenance with a deterministic bound", async () => {
    const record: any = { params: [], orderBy: [] }
    queueSelects([LISTED_ROWS[0]], [], [], record)

    await readListedHubLeagues()

    expect(record.table).toBe(tenants)
    expect(record.params).toContain("listed")
    expect(record.limit).toBe(PUBLIC_HUB_LEAGUE_LIMIT + 1)
    expect(record.orderBy.join(" ")).toContain("asc")
  })

  it("aggregate counts carry the exact publication predicates and no wider statuses", async () => {
    const record: any = { aggregate: { params: [], joinParams: [] } }
    const select = vi.fn()
      .mockImplementationOnce(() => {
        const chain: any = { from: () => chain, where: () => chain, orderBy: () => chain,
          limit: () => ({ then: (resolve: any) => Promise.resolve(LISTED_ROWS).then(resolve) }) }
        return chain
      })
      .mockImplementation(() => {
        const chain: any = {
          from: () => chain,
          leftJoin: (_t: any, where?: any) => {
            record.aggregate.joinParams.push(...dialect.sqlToQuery(where).params)
            return chain
          },
          where: (where: any) => { record.aggregate.params.push(...dialect.sqlToQuery(where).params); return chain },
          groupBy: () => chain,
          then: (resolve: any) => Promise.resolve([]).then(resolve),
        }
        return chain
      })
    ;(db as any).select = select

    await readListedHubLeagues()

    // Both aggregate WHEREs are captured; the live-count join clause is the one
    // binding tournaments.parent publication to the match (join on live query).
    const liveJoinParams = record.aggregate.joinParams
    const allParams = [...record.aggregate.params, ...liveJoinParams]
    expect(allParams).toContain("registration")
    expect(allParams).toContain("live")
    expect(allParams).not.toContain("draft")
    expect(allParams).not.toContain("cancelled")
  })
})

describe("hubLeagueUrl link rules (no unlisted links are fabricated)", () => {
  const slugRow = { slug: "beta", customDomain: null, customDomainVerified: false, sslEnabled: false }
  it.each([
    ["verified ssl custom domain → absolute link", { slug: "alpha", customDomain: "play.alpha.com", customDomainVerified: true, sslEnabled: true }, "https://play.alpha.com"],
    ["unverified custom domain → no link", { slug: "alpha", customDomain: "play.alpha.com", customDomainVerified: false, sslEnabled: true }, null],
    ["ssl not confirmed → no link", { slug: "alpha", customDomain: "play.alpha.com", customDomainVerified: true, sslEnabled: false }, null],
    ["no domain (subdomain-only) → no fabricated link", slugRow, null],
  ])("%s", (_name, league, expected) => {
    expect(hubLeagueUrl(league)).toBe(expected)
  })
})
