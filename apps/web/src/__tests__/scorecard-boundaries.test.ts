import { beforeEach, describe, expect, it, vi } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import { saveScorecard, getFullScorecard, getInningsScorecard } from "@/app/actions/scorecards"

const mocks = vi.hoisted(() => ({ auth: vi.fn(), tenant: vi.fn(), permission: vi.fn(), fallback: vi.fn(),
  match: vi.fn(), innings: vi.fn(), select: vi.fn(), from: vi.fn(), where: vi.fn(), order: vi.fn(),
  insert: vi.fn(), update: vi.fn(), del: vi.fn(), transaction: vi.fn(), revalidate: vi.fn() }))
vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }))
vi.mock("@/lib/rbac-server", () => ({ requirePermissionServer: mocks.permission, resolveActiveTenantId: mocks.tenant }))
vi.mock("@/app/actions/tenants", () => ({ getMyTenant: mocks.fallback }))
vi.mock("@mtk/database", async original => ({ ...await original<typeof import("@mtk/database")>(), db: {
  query: { matches: { findFirst: mocks.match }, matchInnings: { findFirst: mocks.innings } },
  select: mocks.select, insert: mocks.insert, update: mocks.update, delete: mocks.del, transaction: mocks.transaction,
} }))
const TENANT = "00000000-0000-4000-8000-000000000001"
const MATCH = "00000000-0000-4000-8000-000000000002"
const INNINGS = "00000000-0000-4000-8000-000000000003"
const OTHER = "00000000-0000-4000-8000-000000000004"
const dialect = new PgDialect()
const input = { tenantId: TENANT, matchId: MATCH, inningsId: INNINGS, batting: [], bowling: [] }
function noWrites() {
  expect(mocks.insert).not.toHaveBeenCalled()
  expect(mocks.update).not.toHaveBeenCalled()
  expect(mocks.del).not.toHaveBeenCalled()
  expect(mocks.transaction).not.toHaveBeenCalled()
  expect(mocks.revalidate).not.toHaveBeenCalled()
}
beforeEach(() => {
  vi.resetAllMocks()
  mocks.auth.mockResolvedValue({ userId: "clerk" })
  mocks.tenant.mockResolvedValue(TENANT)
  mocks.permission.mockResolvedValue(undefined)
  mocks.fallback.mockImplementation(() => { throw new Error("Do not use fallback league") })
  mocks.match.mockResolvedValue({ id: MATCH, tenantId: TENANT })
  mocks.innings.mockResolvedValue({ id: INNINGS, matchId: MATCH, tenantId: TENANT })
  mocks.select.mockReturnValue({ from: mocks.from })
  mocks.from.mockReturnValue({ where: mocks.where })
  mocks.where.mockReturnValue({ orderBy: mocks.order,
    then: (resolve: (rows: unknown[]) => unknown) => resolve([]) })
  mocks.order.mockResolvedValue([])
})

describe("Retired manual scorecard write entry point", () => {
  it.each([input, { ...input, tenantId: OTHER }, { ...input, batting: [{ playerId: OTHER, runs: 999 }] }, null, undefined])(
    "fails closed regardless of legacy payload %s, without an alternate writer", async payload => {
      await expect(saveScorecard(payload as never)).rejects.toThrow("Manual scorecard writes are disabled")
      expect(mocks.permission).toHaveBeenCalledWith("scorecard:create", TENANT)
      expect(mocks.select).not.toHaveBeenCalled()
      expect(mocks.match).not.toHaveBeenCalled()
      expect(mocks.fallback).not.toHaveBeenCalled()
      noWrites()
    },
  )
  it("does not bypass authentication just because writes are disabled", async () => {
    mocks.auth.mockResolvedValue({ userId: null })
    await expect(saveScorecard(input)).rejects.toThrow("Unauthorized")
    noWrites()
  })
  it("does not bypass exact-league permissions just because writes are disabled", async () => {
    mocks.permission.mockImplementation(async (_permission, tenantId) => { if (tenantId) throw new Error("Forbidden") })
    await expect(saveScorecard(input)).rejects.toThrow("Forbidden")
    noWrites()
  })
})

describe.each(["full", "innings"] as const)("%s scorecard hierarchy and active league", mode => {
  const read = () => mode === "full" ? getFullScorecard(MATCH) : getInningsScorecard(INNINGS)
  it("requires current exact-league permission before resolving private data", async () => {
    await expect(read()).resolves.toEqual(mode === "full" ? { batting: [], bowling: [], fielding: [] } : { batting: [], bowling: [] })
    expect(mocks.permission).toHaveBeenCalledWith("scorecard:read", TENANT)
    expect(mocks.fallback).not.toHaveBeenCalled()
    expect(dialect.sqlToQuery(mocks.match.mock.calls[0][0].where).params).toEqual([MATCH, TENANT])
    expect(mocks.select.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.match.mock.invocationCallOrder[0])
    noWrites()
  })
  it.each([null, { id: OTHER, tenantId: TENANT }, { id: MATCH, tenantId: OTHER }])("rejects unavailable parent match %s before child queries", async match => {
    mocks.match.mockResolvedValue(match)
    await expect(read()).rejects.toThrow("Match not found")
    expect(mocks.select).not.toHaveBeenCalled()
    noWrites()
  })
  it("rejects a lookup failure instead of reading another league", async () => {
    mocks.tenant.mockRejectedValue(new Error("Resolution unavailable"))
    await expect(read()).rejects.toThrow("Resolution unavailable")
    expect(mocks.match).not.toHaveBeenCalled()
    expect(mocks.innings).not.toHaveBeenCalled()
    expect(mocks.select).not.toHaveBeenCalled()
  })
  it("rejects a missing active league", async () => {
    mocks.tenant.mockResolvedValue(null)
    await expect(read()).rejects.toThrow("Tenant not found")
    expect(mocks.select).not.toHaveBeenCalled()
  })
  it("rejects anonymous access even when the outer guard is mocked", async () => {
    mocks.auth.mockResolvedValue({ userId: null })
    await expect(read()).rejects.toThrow("Unauthorized")
    expect(mocks.select).not.toHaveBeenCalled()
  })
  it("rejects denied exact-tenant permission before hierarchy lookups", async () => {
    mocks.permission.mockImplementation(async (_permission, tenantId) => { if (tenantId) throw new Error("Forbidden") })
    await expect(read()).rejects.toThrow("Forbidden")
    expect(mocks.match).not.toHaveBeenCalled()
    expect(mocks.innings).not.toHaveBeenCalled()
    expect(mocks.select).not.toHaveBeenCalled()
  })
  it("rejects invalid identifiers before SQL", async () => {
    await expect(mode === "full" ? getFullScorecard("bad") : getInningsScorecard("bad")).rejects.toThrow()
    expect(mocks.select).not.toHaveBeenCalled()
    expect(mocks.match).not.toHaveBeenCalled()
    expect(mocks.innings).not.toHaveBeenCalled()
  })
  it("propagates hierarchy database failure without false empty results", async () => {
    mocks.match.mockRejectedValue(new Error("Database unavailable"))
    await expect(read()).rejects.toThrow("Database unavailable")
    expect(mocks.select).not.toHaveBeenCalled()
  })
})

describe("Scorecard child-query scope", () => {
  it("correlates full-match batting and bowling to exact-tenant innings in that same match", async () => {
    await getFullScorecard(MATCH)
    const queries = mocks.where.mock.calls.map(([query]) => dialect.sqlToQuery(query))
    for (const [index, table] of ["batting_scorecards", "bowling_scorecards"].entries()) {
      expect(queries[index].params).toEqual([MATCH, TENANT, MATCH, TENANT])
      expect(queries[index].sql).toContain('exists (SELECT 1 FROM "match_innings"')
      expect(queries[index].sql).toContain(`"match_innings"."id" = "${table}"."innings_id"`)
      expect(queries[index].sql).toContain('"match_innings"."match_id" =')
      expect(queries[index].sql).toContain('"match_innings"."tenant_id" =')
    }
    expect(queries[2].params).toEqual([MATCH, TENANT])
  })
  it("resolves an innings in the active league, checks its match and binds both keys in each child read", async () => {
    await getInningsScorecard(INNINGS)
    expect(dialect.sqlToQuery(mocks.innings.mock.calls[0][0].where).params).toEqual([INNINGS, TENANT])
    expect(mocks.match.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.innings.mock.invocationCallOrder[0])
    for (const [query] of mocks.where.mock.calls) expect(dialect.sqlToQuery(query).params).toEqual([INNINGS, MATCH, TENANT])
  })
  it.each([null, { id: OTHER, tenantId: TENANT, matchId: MATCH }, { id: INNINGS, tenantId: OTHER, matchId: MATCH }])(
    "does not follow unavailable/foreign innings %s", async innings => {
      mocks.innings.mockResolvedValue(innings)
      await expect(getInningsScorecard(INNINGS)).rejects.toThrow("Innings not found")
      expect(mocks.match).not.toHaveBeenCalled()
      expect(mocks.select).not.toHaveBeenCalled()
    },
  )
})
