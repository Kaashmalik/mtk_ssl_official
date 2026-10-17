import { beforeEach, describe, expect, it, vi } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import { tournaments, playerSeasonStats, players, tenants, db } from "@mtk/database"
import { readPublicCareerProfile, toPublicCareerLeagues } from "@/lib/public-career-profile"

// Only the db handle is mocked; real schema tables and the real PUB-02/03 policies pass through.
vi.mock("@mtk/database", async (importOriginal) => ({
  ...await importOriginal<typeof import("@mtk/database")>(),
  db: { select: vi.fn() },
}))

const USER = "00000000-0000-4000-8000-0000000000a1"
const CONSENT_DATE = new Date("2026-10-17T00:00:00Z")
const dialect = new PgDialect()

/**
 * Queues the two selects in order: the account row, then the league
 * aggregate. The aggregate's query record is captured for shape assertions.
 */
function queueSelects(accountRow: unknown, aggregateRows: unknown[] = [], record?: any) {
  const select = vi.fn()
    .mockImplementationOnce(() => ({
      from: () => ({ where: () => ({ limit: async () => accountRow }) }),
    }))
    .mockImplementationOnce(() => {
      const chain: any = {
        from: (table: any) => { if (record) record.table = table; return chain },
        innerJoin: (_t: any, where?: any) => {
          if (record) {
            record.joins.push(_t)
            if (where) record.params.push(...dialect.sqlToQuery(where).params)
          }
          return chain
        },
        where: (where: any) => { if (record) record.params.push(...dialect.sqlToQuery(where).params); return chain },
        groupBy: () => { if (record) record.steps.push("groupBy"); return chain },
        orderBy: () => { if (record) record.steps.push("orderBy"); return chain },
        limit: (n: number) => { if (record) record.limitValue = n; return chain },
        then: (resolve: any) => Promise.resolve(aggregateRows).then(resolve),
      }
      return chain
    })
  ;(db as any).select = select
}

const ELIGIBLE_ACCOUNT = { id: USER, isActive: true, publicCareerConsentAt: CONSENT_DATE }
const LISTED_LEAGUE_ROW = {
  tenantId: "t1",
  leagueName: "Alpha",
  slug: "alpha",
  customDomain: "play.alpha.com",
  customDomainVerified: true,
  sslEnabled: true,
  hubListedAt: CONSENT_DATE,
  totalRuns: 120,
  totalWickets: 3,
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe("Public career profile pure mapping", () => {
  it("normalizes SQL sums, zero-defaults missing sums and links only verified domains", () => {
    expect(toPublicCareerLeagues([
      LISTED_LEAGUE_ROW,
      { ...LISTED_LEAGUE_ROW, tenantId: "t2", leagueName: "Beta", customDomain: null, totalRuns: null, totalWickets: null },
    ])).toEqual([
      { tenantId: "t1", leagueName: "Alpha", url: "https://play.alpha.com", runsScored: 120, wicketsTaken: 3 },
      { tenantId: "t2", leagueName: "Beta", url: null, runsScored: 0, wicketsTaken: 0 },
    ])
  })
})

describe("Public career profile gate (PUB-02 remainder)", () => {
  it("is indistinguishable from missing for unknown, inactive or unconsenting ids — and issues no cross-league query", async () => {
    for (const row of [undefined, { id: USER, isActive: false, publicCareerConsentAt: CONSENT_DATE }, { id: USER, isActive: true, publicCareerConsentAt: null }]) {
      queueSelects(row === undefined ? [] : [row])
      await expect(readPublicCareerProfile(USER)).resolves.toBeNull()
      // One select only: the account lookup — the aggregate never runs.
      expect((db as any).select).toHaveBeenCalledTimes(1)
    }
  })

  it("with consent folds hub-listed, published-only league totals through the authoritative merge", async () => {
    queueSelects([ELIGIBLE_ACCOUNT], [LISTED_LEAGUE_ROW])
    const read = await readPublicCareerProfile(USER)
    expect(read).not.toBeNull()
    expect(read!.complete).toBe(true)
    expect(read!.limit).toBe(50)
    expect(read!.career.leagues).toHaveLength(1)
    expect(read!.career.totalRunsScored).toBe(120)
    expect(read!.career.totalWicketsTaken).toBe(3)
  })

  it("never lets hidden overflow leagues inflate the headline total, and discloses incompleteness", async () => {
    const rows = Array.from({ length: 51 }, (_, i) => ({
      ...LISTED_LEAGUE_ROW,
      tenantId: `t${i}`,
      leagueName: `League ${i}`,
      totalRuns: 1,
      totalWickets: 0,
    }))
    queueSelects([ELIGIBLE_ACCOUNT], rows)
    const read = await readPublicCareerProfile(USER)
    expect(read!.complete).toBe(false)
    expect(read!.career.leagues).toHaveLength(50)
    // Fold covers exactly the shown page: 50 leagues x 1 run.
    expect(read!.career.totalRunsScored).toBe(50)
  })

  it("renders an honest consented zero state when no listed league has published performances", async () => {
    queueSelects([ELIGIBLE_ACCOUNT], [])
    const read = await readPublicCareerProfile(USER)
    expect(read!.career.leagues).toEqual([])
    expect(read!.career.totalRunsScored).toBe(0)
    expect(read!.complete).toBe(true)
  })
})

describe("Public career profile query shape", () => {
  it("aggregates across leagues with hub-listing and published-tournament predicates in the joins", async () => {
    const record: any = { params: [], joins: [], steps: [] }
    queueSelects([ELIGIBLE_ACCOUNT], [], record)
    await readPublicCareerProfile(USER)
    // Identity-anchored: linked, active player rows only — no tenant pin, this
    // is the one deliberate cross-league read on the public surface.
    expect(record.table).toBe(players)
    expect(record.joins).toEqual([playerSeasonStats, tournaments, tenants])
    // Publication predicates identical to the single-league public pages...
    expect(record.params).toContain("registration")
    expect(record.params).toContain("completed")
    expect(record.params).not.toContain("draft")
    expect(record.params).not.toContain("cancelled")
    // ...plus the hub-listing gate: only 'listed' leagues, never 'unlisted'.
    expect(record.params).toContain("listed")
    expect(record.params).not.toContain("unlisted")
    expect(record.params).toContain(USER)
    expect(record.steps).toEqual(["groupBy", "orderBy"])
    expect(record.limitValue).toBe(51)
  })
})
