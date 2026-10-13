import { beforeEach, describe, expect, it, vi } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import { getTableName } from "drizzle-orm"
import { getDashboardStats, getDashboardMatches, getDashboardAttention, loadDashboardSection } from "@/lib/dashboard-data"
import type { DashboardContext } from "@/lib/dashboard-context"

const mocks = vi.hoisted(() => ({ select: vi.fn(), queries: [] as any[], rows: {} as Record<string, any[]>, fail: "" }))
vi.mock("@mtk/database", async (importOriginal) => ({
  ...await importOriginal<typeof import("@mtk/database")>(), db: { select: mocks.select },
}))
const context: DashboardContext = { tenantId: "tenant", actorId: "actor", tenantName: "League", role: "league_owner" }
const match = { id: "match", tenantId: "tenant", teamAId: "a", teamBId: "b", status: "live", scorerId: "actor", scheduledDate: null, updatedAt: new Date(), result: null }
const dialect = new PgDialect()
beforeEach(() => {
  vi.resetAllMocks()
  mocks.queries.length = 0
  mocks.fail = ""
  mocks.rows = { matches: [match], teams: [{ id: "a", name: "A" }, { id: "b", name: "B" }], match_innings: [], league_registrations: [] }
  mocks.select.mockImplementation((fields) => {
    const query: any = { table: "", fields, where: null, order: [], limit: null }
    mocks.queries.push(query)
    const result = () => {
      if (mocks.fail === query.table) return Promise.reject(new Error("query unavailable"))
      const rows = fields?.value ? [{ value: query.table === "teams" ? 2 : 1 }] : mocks.rows[query.table] ?? []
      return Promise.resolve(query.limit ? rows.slice(0, query.limit) : rows)
    }
    const chain: any = {
      from: (table) => { query.table = getTableName(table); return chain },
      where: (where) => { query.where = where; return chain },
      orderBy: (...order) => { query.order = order; return chain },
      limit: (limit) => { query.limit = limit; return chain },
      then: (resolve, reject) => result().then(resolve, reject),
    }
    return chain
  })
})
function predicates() { return mocks.queries.map((query) => ({ ...query, ...dialect.sqlToQuery(query.where) })) }

describe("Scoped bounded dashboard reads", () => {
  it("uses four independent tenant-scoped aggregate counts with active-player filters", async () => {
    expect(await getDashboardStats(context)).toEqual({ teams: 2, players: 1, tournaments: 1, matches: 1 })
    expect(predicates().map((q) => q.params)).toEqual([["tenant", true], ["tenant", true, "active"], ["tenant"], ["tenant"]])
    expect(mocks.queries.every((q) => q.fields.value)).toBe(true)
  })
  it.each(["live", "upcoming", "recent", "assigned"] as const)("scopes %s matches and both related lookups to the same tenant", async (group) => {
    const result = await getDashboardMatches({ ...context, role: "scorer" }, group)
    expect(result).toHaveLength(1)
    expect(predicates().every((q) => q.params[0] === "tenant")).toBe(true)
    const matchQuery = predicates()[0]
    expect(matchQuery.limit).toBe(5)
    expect(matchQuery.order.map((o) => dialect.sqlToQuery(o).sql).join(" ")).toContain('"matches"."id" asc')
    if (group === "assigned") expect(matchQuery.params).toEqual(["tenant", "actor", "actor", "scheduled", "toss", "live", "innings_break"])
    if (group === "live") expect(matchQuery.params).toEqual(["tenant", "live", "innings_break", "toss"])
    if (group === "upcoming") expect(matchQuery.params).toEqual(["tenant", "scheduled"])
    if (group === "recent") expect(matchQuery.params).toEqual(["tenant", "completed"])
    expect(predicates()[1].params).toEqual(["tenant", "a", "b"])
    expect(predicates()[2].params).toEqual(["tenant", "match"])
  })
  it("does not query assignments for non-scorer roles", async () => {
    expect(await getDashboardMatches(context, "assigned")).toEqual([])
    expect(mocks.select).not.toHaveBeenCalled()
  })
  it("includes backup assignments in the exact-league predicate and retains the slot in summaries", async () => {
    mocks.rows.matches = [{ ...match, scorerId: "primary", backupScorerId: "actor" }]
    const result = await getDashboardMatches({ ...context, role: "scorer" }, "assigned")
    expect(predicates()[0].sql).toContain('"backup_scorer_id"')
    expect(predicates()[0].sql).toContain(" or ")
    expect(result[0].backupScorerId).toBe("actor")
    expect(mocks.queries[0].fields).toHaveProperty("backupScorerId")
  })
  it("returns empty successful results without empty IN queries", async () => {
    mocks.rows.matches = []
    expect(await getDashboardMatches(context, "live")).toEqual([])
    expect(mocks.select).toHaveBeenCalledOnce()
  })
  it("batch-fetches teams and innings in two queries rather than per-match lookups", async () => {
    mocks.rows.matches = Array.from({ length: 10 }, (_, i) => ({ ...match, id: `match-${i}` }))
    expect(await getDashboardMatches(context, "live")).toHaveLength(5)
    expect(mocks.select).toHaveBeenCalledTimes(3)
    expect(predicates()[1].params).toEqual(["tenant", "a", "b"])
    expect(predicates()[2].params).toEqual(["tenant", "match-0", "match-1", "match-2", "match-3", "match-4"])
  })
  it("orders undated fixtures last and live assignments before scheduled matches", async () => {
    await getDashboardMatches({ ...context, role: "scorer" }, "assigned")
    const order = mocks.queries[0].order.map((o) => dialect.sqlToQuery(o).sql).join(" ")
    expect(order).toContain("CASE WHEN")
    expect(order).toContain("ASC NULLS LAST")
  })
  it("uses two scoped task counts, excluding ended matches and nonpending registrations", async () => {
    expect(await getDashboardAttention(context)).toEqual({ unassigned: 1, pending: 1 })
    const queries = predicates()
    expect(queries[0].params).toEqual(["tenant", "scheduled", "toss", "live", "innings_break"])
    expect(queries[0].sql).toContain('"matches"."scorer_id" is null')
    expect(queries[1].params).toEqual(["tenant", "pending"])
  })
  it.each(["scorer", "coach", "team_manager", "player", "fan"] as const)("does not fetch organizer-only task counts for %s", async (role) => {
    expect(await getDashboardAttention({ ...context, role })).toBeNull()
    expect(mocks.select).not.toHaveBeenCalled()
  })
  it.each(["teams", "match_innings"])("does not present a partially failed %s lookup as empty success", async (table) => {
    mocks.fail = table
    expect(await loadDashboardSection(() => getDashboardMatches(context, "live"))).toEqual({ status: "unavailable" })
  })
  it("distinguishes confirmed empty data and real zeros from failed reads", async () => {
    expect(await loadDashboardSection(async () => [])).toEqual({ status: "ready", data: [] })
    expect(await loadDashboardSection(async () => 0)).toEqual({ status: "ready", data: 0 })
    mocks.fail = "players"
    expect(await loadDashboardSection(() => getDashboardStats(context))).toEqual({ status: "unavailable" })
  })
})
