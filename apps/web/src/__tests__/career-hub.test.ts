import { beforeEach, describe, expect, it, vi } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import { tournaments, playerSeasonStats, players, tenants, db } from "@mtk/database"
import { readConsentedCareerByClerkId, toCareerLeagues } from "@/lib/career-hub"

const mocks = vi.hoisted(() => ({ auth: vi.fn() }))

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }))
// Only the db handle is mocked; real schema tables and the real PUB-03 policy pass through.
vi.mock("@mtk/database", async (importOriginal) => ({
  ...await importOriginal<typeof import("@mtk/database")>(),
  db: { select: vi.fn() },
}))

const CLERK = "clerk_1"
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
        then: (resolve: any) => Promise.resolve(aggregateRows).then(resolve),
      }
      return chain
    })
  ;(db as any).select = select
}

const ACTIVE_ACCOUNT = { id: USER, isActive: true, publicCareerConsentAt: CONSENT_DATE }

beforeEach(() => {
  vi.resetAllMocks()
  mocks.auth.mockResolvedValue({ userId: CLERK })
})

describe("Career hub pure mapping", () => {
  it("normalizes SQL sums to numbers with zero defaults (no fabricated league rows)", () => {
    expect(toCareerLeagues([
      { tenantId: "t1", leagueName: "Alpha", totalRuns: 40, totalWickets: 2 },
      { tenantId: "t2", leagueName: "Beta", totalRuns: null, totalWickets: null },
    ])).toEqual([
      { tenantId: "t1", leagueName: "Alpha", runsScored: 40, wicketsTaken: 2 },
      { tenantId: "t2", leagueName: "Beta", runsScored: 0, wicketsTaken: 0 },
    ])
  })
})

describe("Consented career hub (PUB-02 slice)", () => {
  it("fails closed on a missing or inactive account", async () => {
    queueSelects([])
    await expect(readConsentedCareerByClerkId(CLERK)).rejects.toThrow("Forbidden: career account unavailable")
    queueSelects([{ id: USER, isActive: false, publicCareerConsentAt: CONSENT_DATE }])
    await expect(readConsentedCareerByClerkId(CLERK)).rejects.toThrow("Forbidden: career account unavailable")
  })

  it("without consent returns no career and issues no cross-league query", async () => {
    queueSelects([{ id: USER, isActive: true, publicCareerConsentAt: null }])
    const hub = await readConsentedCareerByClerkId(CLERK)
    expect(hub).toEqual({ consented: false, career: null, leagues: [] })
    // The cross-league aggregate select was never issued.
    expect((db as any).select).toHaveBeenCalledTimes(1)
  })

  it("with consent folds published per-league totals through the authoritative merge", async () => {
    queueSelects([ACTIVE_ACCOUNT], [
      { tenantId: "t1", leagueName: "Alpha", totalRuns: 120, totalWickets: 3 },
      { tenantId: "t2", leagueName: "Beta", totalRuns: 80, totalWickets: 11 },
    ])
    const hub = await readConsentedCareerByClerkId(CLERK)
    expect(hub.consented).toBe(true)
    expect(hub.career).toEqual({
      leagues: [
        { tenantId: "t1", leagueName: "Alpha", runsScored: 120, wicketsTaken: 3 },
        { tenantId: "t2", leagueName: "Beta", runsScored: 80, wicketsTaken: 11 },
      ],
      totalRunsScored: 200,
      totalWicketsTaken: 14,
    })
    expect(hub.leagues.map((l) => l.leagueName)).toEqual(["Alpha", "Beta"])
  })
})

describe("Hub aggregate query shape", () => {
  it("aggregates per league through the same published-tournament predicates", async () => {
    const record: any = { params: [], joins: [], steps: [] }
    queueSelects([ACTIVE_ACCOUNT], [], record)
    await readConsentedCareerByClerkId(CLERK)
    // Identity-anchored: linked, active player rows only.
    expect(record.table).toBe(players)
    // One join per hop, column-to-column tenant edges without league drift.
    expect(record.joins).toEqual([playerSeasonStats, tournaments, tenants])
    // Publication predicates are exactly the public leaderboard's: no drafts,
    // no cancelled — and the whole query is grouped per league.
    expect(record.params).toContain("registration")
    expect(record.params).toContain("completed")
    expect(record.params).not.toContain("draft")
    expect(record.params).not.toContain("cancelled")
    expect(record.params).toContain(USER)
    expect(record.steps).toEqual(["groupBy"])
  })
})
