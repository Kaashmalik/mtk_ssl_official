import { beforeEach, describe, expect, it, vi } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import { matches, auditLogs, COMPETITION_LOCKED_MESSAGE } from "@mtk/database"
import { createMatch, updateMatch, deleteMatch, rescheduleMatch, startStream, endStream, getMatch, getMatches, getMatchFormOptions } from "@/app/actions/matches"
import { getFullScorecard } from "@/app/actions/scorecards"

const mocks = vi.hoisted(() => ({ auth: vi.fn(), tenant: vi.fn(), permission: vi.fn(), fallback: vi.fn(),
  transaction: vi.fn(), execute: vi.fn(), match: vi.fn(), user: vi.fn(), league: vi.fn(), member: vi.fn(),
  team: vi.fn(), tournament: vi.fn(), venue: vi.fn(), history: vi.fn(), update: vi.fn(), set: vi.fn(), where: vi.fn(),
  returning: vi.fn(), insert: vi.fn(), values: vi.fn(), insertReturning: vi.fn(), revalidate: vi.fn(), plan: vi.fn(),
  directUpdate: vi.fn(), del: vi.fn(), select: vi.fn(), readWhere: vi.fn(), limit: vi.fn(), order: vi.fn(),
  offset: vi.fn(), context: vi.fn(), from: vi.fn() }))
vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }))
vi.mock("@/lib/rbac-server", () => ({ resolveActiveTenantId: mocks.tenant, requirePermissionServer: mocks.permission }))
vi.mock("@/app/actions/tenants", () => ({ getMyTenant: mocks.fallback }))
vi.mock("@mtk/database", async original => ({ ...await original<typeof import("@mtk/database")>(),
  checkPlanFeature: mocks.plan, withTenantContext: mocks.context,
  db: { transaction: mocks.transaction, select: mocks.select, update: mocks.directUpdate, delete: mocks.del,
    query: { matches: { findFirst: mocks.match } } } }))
const TENANT = "00000000-0000-4000-8000-000000000001"
const MATCH = "00000000-0000-4000-8000-000000000002"
const ACTOR = "00000000-0000-4000-8000-000000000003"
const A = "00000000-0000-4000-8000-000000000004"
const B = "00000000-0000-4000-8000-000000000005"
const TOURNAMENT = "00000000-0000-4000-8000-000000000006"
const VENUE = "00000000-0000-4000-8000-000000000007"
const OTHER = "00000000-0000-4000-8000-000000000008"
const fixture = { id: MATCH, tenantId: TENANT, teamAId: A, teamBId: B, tournamentId: null, venueId: null,
  status: "scheduled", matchFormat: "t20", matchType: "group", totalOvers: 20, scheduledDate: null,
  startDate: null, endDate: null, tossWinnerId: null, tossDecision: null, winnerId: null, result: null, manOfMatchId: null,
  streamStatus: "idle", streamSource: null, liveStreamUrl: null, scorerId: null, backupScorerId: null }
const actor = { id: ACTOR, clerkId: "clerk", isActive: true }
const member = { userId: ACTOR, tenantId: TENANT, role: "league_owner", status: "active" }
const dialect = new PgDialect()
const metadata = { teamAId: A, teamBId: B, matchFormat: "t20" as const, matchType: "friendly" as const, totalOvers: 20 }
const historyTables = ["matchInnings", "matchBalls", "scoringEvents", "scorecardProjections", "battingScorecards",
  "bowlingScorecards", "fieldingScorecards"]
const commands = ["create", "update", "cancel", "stream-start", "stream-end"] as const
function run(command: typeof commands[number]) {
  if (command === "create") return createMatch(metadata)
  if (command === "update") return updateMatch(MATCH, { umpire1: "Umpire" })
  if (command === "cancel") return deleteMatch(MATCH)
  if (command === "stream-start") return startStream(MATCH, "youtube", "https://youtu.be/example")
  return endStream(MATCH)
}
function noWrites() {
  expect(mocks.update).not.toHaveBeenCalled()
  expect(mocks.insert).not.toHaveBeenCalled()
  expect(mocks.directUpdate).not.toHaveBeenCalled()
  expect(mocks.del).not.toHaveBeenCalled()
  expect(mocks.revalidate).not.toHaveBeenCalled()
}
beforeEach(() => {
  vi.resetAllMocks()
  mocks.auth.mockResolvedValue({ userId: "clerk" })
  mocks.tenant.mockResolvedValue(TENANT)
  mocks.permission.mockResolvedValue(undefined)
  mocks.fallback.mockImplementation(() => { throw new Error("Never use owned/default league") })
  mocks.match.mockResolvedValue(fixture)
  mocks.user.mockResolvedValue(actor)
  mocks.member.mockResolvedValue(member)
  mocks.league.mockResolvedValue({ id: TENANT, isActive: true, plan: "pro" })
  mocks.execute.mockResolvedValue([])
  mocks.team.mockImplementation(async ({ where }) => ({ id: dialect.sqlToQuery(where).params[0], tenantId: TENANT, isActive: true }))
  mocks.tournament.mockResolvedValue({ id: TOURNAMENT, tenantId: TENANT, status: "live", competitionLockedAt: null })
  mocks.venue.mockResolvedValue({ id: VENUE, tenantId: TENANT, isActive: true })
  mocks.history.mockResolvedValue(undefined)
  mocks.update.mockReturnValue({ set: mocks.set })
  mocks.set.mockReturnValue({ where: mocks.where })
  mocks.where.mockReturnValue({ returning: mocks.returning })
  mocks.returning.mockImplementation(async () => [{ ...fixture, ...mocks.set.mock.calls.at(-1)![0] }])
  mocks.insert.mockReturnValue({ values: mocks.values })
  mocks.values.mockReturnValue({ returning: mocks.insertReturning })
  mocks.insertReturning.mockImplementation(async () => [{ ...fixture, ...mocks.values.mock.calls[0][0] }])
  mocks.transaction.mockImplementation(async fn => fn({ execute: mocks.execute,
    select: mocks.select,
    query: { matches: { findFirst: mocks.match }, users: { findFirst: mocks.user }, tenants: { findFirst: mocks.league },
      userTenantRoles: { findFirst: mocks.member }, teams: { findFirst: mocks.team },
      tournaments: { findFirst: mocks.tournament }, venues: { findFirst: mocks.venue },
      ...Object.fromEntries(historyTables.map(name => [name, { findFirst: mocks.history }])) },
    update: mocks.update, insert: mocks.insert,
  }))
  mocks.context.mockImplementation(async (_ctx, fn) => fn())
  mocks.select.mockReturnValue({ from: mocks.from })
  mocks.from.mockReturnValue({ where: mocks.readWhere })
  mocks.readWhere.mockReturnValue({ limit: mocks.limit, orderBy: mocks.order, then: (resolve: (value: unknown) => unknown) => resolve([{ total: 1 }]) })
  mocks.order.mockReturnValue({ limit: mocks.limit, then: (resolve: (value: unknown) => unknown) => resolve([]) })
  mocks.limit.mockReturnValue({ offset: mocks.offset, then: (resolve: (value: unknown) => unknown) => resolve([fixture]) })
  mocks.offset.mockResolvedValue([fixture])
})

describe.each(commands)("Current %s authority", command => {
  it("uses exact active league and locks account, league, membership before writing an atomic audit", async () => {
    await expect(run(command)).resolves.toMatchObject({ success: true })
    expect(mocks.fallback).not.toHaveBeenCalled()
    const permission = command === "create" ? "match:create" : command === "cancel" ? "match:delete" : "match:update"
    expect(mocks.permission).toHaveBeenCalledWith(permission, TENANT)
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "read committed" })
    const locks = mocks.execute.mock.calls.map(([query]) => dialect.sqlToQuery(query))
    const index = command === "create" ? 0 : 1
    if (index) {
      expect(locks[0].params).toEqual([MATCH, TENANT])
      expect(locks[0].sql).toContain("FOR UPDATE")
    }
    expect(locks.slice(index, index + 3).map(lock => lock.params)).toEqual([[ACTOR], [TENANT], [ACTOR, TENANT]])
    expect(locks[index].sql).toContain("FOR UPDATE")
    expect(locks[index + 1].sql).toContain("FOR SHARE")
    expect(locks[index + 2].sql).toContain("FOR SHARE")
    expect(mocks.user.mock.invocationCallOrder[1]).toBeGreaterThan(mocks.execute.mock.invocationCallOrder[index + 2])
    expect(mocks.member.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.execute.mock.invocationCallOrder[index + 2])
    expect(mocks.insert.mock.calls.at(-1)![0]).toBe(auditLogs)
    expect(mocks.values.mock.calls.at(-1)![0]).toMatchObject({ tenantId: TENANT, actorId: ACTOR, actorRole: "league_owner",
      method: `MATCH_${command.toUpperCase().replaceAll("-", "_")}`, payload: { matchId: MATCH } })
    expect(mocks.directUpdate).not.toHaveBeenCalled()
    expect(mocks.del).not.toHaveBeenCalled()
    expect(mocks.revalidate.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.values.mock.invocationCallOrder.at(-1)!)
  })
  it.each([null, { isActive: false }, { clerkId: "remapped" }, { clerkId: null }, { id: OTHER }])("rejects changed locked account %s", async change => {
    mocks.user.mockReset().mockResolvedValueOnce(actor).mockResolvedValueOnce(change === null ? null : { ...actor, ...change })
    await expect(run(command)).rejects.toThrow("access changed")
    noWrites()
  })
  it.each([null, { status: "suspended" }, { status: "pending" }, { tenantId: OTHER }, { userId: OTHER },
    ...["super_admin", "scorer", "team_manager", "coach", "fan"].map(role => ({ role }))])("rejects changed exact membership %s", async change => {
    mocks.member.mockResolvedValue(change === null ? null : { ...member, ...change })
    await expect(run(command)).rejects.toThrow("access changed")
    noWrites()
  })
  it.each([null, { id: TENANT, isActive: false }, { id: OTHER, isActive: true }])("rejects unavailable league %s", async league => {
    mocks.league.mockResolvedValue(league)
    await expect(run(command)).rejects.toThrow("access changed")
    noWrites()
  })
  it("does not fall back to default league when active resolution fails", async () => {
    mocks.tenant.mockRejectedValue(new Error("Resolution unavailable"))
    await expect(run(command)).rejects.toThrow("Resolution unavailable")
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.fallback).not.toHaveBeenCalled()
    noWrites()
  })
  it("requires an active tenant", async () => {
    mocks.tenant.mockResolvedValue(null)
    await expect(run(command)).rejects.toThrow("Tenant not found")
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
  it("rejects anonymous sessions before SQL", async () => {
    mocks.auth.mockResolvedValue({ userId: null })
    await expect(run(command)).rejects.toThrow("Unauthorized")
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
  it("rejects a denied explicit tenant permission before SQL", async () => {
    mocks.permission.mockImplementation(async (_permission, tenantId) => { if (tenantId) throw new Error("Forbidden") })
    await expect(run(command)).rejects.toThrow("Forbidden")
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
  it("rejects an unprovisioned actor rather than granting from session claims", async () => {
    mocks.user.mockResolvedValue(undefined)
    await expect(run(command)).rejects.toThrow("account not found")
    noWrites()
  })
  it("propagates audit failure without cache invalidation or false success", async () => {
    mocks.values.mockImplementation(row => {
      if (row.method) throw new Error("Audit unavailable")
      return { returning: mocks.insertReturning }
    })
    await expect(run(command)).rejects.toThrow("Audit unavailable")
    expect(mocks.revalidate).not.toHaveBeenCalled()
    // In-memory transaction double does not certify PostgreSQL rollback.
  })
})

describe.each(["update", "cancel", "stream-start", "stream-end"] as const)("%s exact match", command => {
  it.each([null, { ...fixture, tenantId: OTHER }, { ...fixture, id: OTHER }])("rejects foreign or missing record %s", async match => {
    mocks.match.mockResolvedValue(match)
    await expect(run(command)).rejects.toThrow("Match not found")
    noWrites()
  })
  it("fails a lost write without auditing success", async () => {
    mocks.returning.mockResolvedValue([])
    await expect(run(command)).rejects.toThrow("Match changed")
    expect(mocks.insert).not.toHaveBeenCalled()
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
})

describe("Fixture invariants, resource validation and history preservation", () => {
  it("uses database actor ID for createdBy and never accepts a client audit identity", async () => {
    await createMatch({ ...metadata, tournamentId: TOURNAMENT, venueId: VENUE })
    expect(mocks.insert.mock.calls[0][0]).toBe(matches)
    expect(mocks.values.mock.calls[0][0]).toMatchObject({ tenantId: TENANT, createdBy: ACTOR, status: "scheduled" })
    const locks = mocks.execute.mock.calls.map(([query]) => dialect.sqlToQuery(query))
    expect(locks.slice(3).map(lock => lock.params)).toEqual([[TENANT, A, B], [TOURNAMENT, TENANT], [VENUE, TENANT]])
    expect(locks[3].sql).toContain("ORDER BY")
    expect(locks.slice(3).every(lock => lock.sql.includes("FOR SHARE"))).toBe(true)
    expect(mocks.team.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.execute.mock.invocationCallOrder[3])
    // The lock gate legitimately pre-reads the competition row (query,
    // no lock) before the FOR SHARE chain; requireReferences' own read
    // must still follow its FOR SHARE.
    expect(mocks.tournament.mock.invocationCallOrder[1]).toBeGreaterThan(mocks.execute.mock.invocationCallOrder[4])
    expect(mocks.venue.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.execute.mock.invocationCallOrder[5])
  })
  it.each([() => createMatch({ ...metadata, teamBId: A }), () => updateMatch(MATCH, { teamAId: B }),
    () => updateMatch(MATCH, { teamBId: A })])("rejects self-match after merging the stored pair", async command => {
    await expect(command()).rejects.toThrow("cannot play against itself")
    noWrites()
  })
  it("allows a two-team swap and preserves omitted metadata/assignment fields", async () => {
    await updateMatch(MATCH, { teamAId: B, teamBId: A })
    expect(mocks.set).toHaveBeenCalledWith({ teamAId: B, teamBId: A, updatedAt: expect.any(Date) })
  })
  it.each([null, { id: A, tenantId: OTHER, isActive: true }, { id: OTHER, tenantId: TENANT, isActive: true },
    { id: A, tenantId: TENANT, isActive: false }])("rejects missing/foreign/inactive team %s", async team => {
    mocks.team.mockResolvedValue(team)
    await expect(createMatch(metadata)).rejects.toThrow("team is unavailable")
    noWrites()
  })
  it.each([null, { id: OTHER, tenantId: TENANT, status: "live", competitionLockedAt: null }, { id: TOURNAMENT, tenantId: OTHER, status: "live", competitionLockedAt: null },
    { id: TOURNAMENT, tenantId: TENANT, status: "cancelled", competitionLockedAt: null }, { id: TOURNAMENT, tenantId: TENANT, status: "completed", competitionLockedAt: null }])(
    "rejects missing/foreign/ended tournament %s", async tournament => {
      mocks.tournament.mockResolvedValue(tournament)
      await expect(updateMatch(MATCH, { tournamentId: TOURNAMENT })).rejects.toThrow("Tournament is unavailable")
      noWrites()
    },
  )
  it.each([null, { id: OTHER, tenantId: TENANT, isActive: true }, { id: VENUE, tenantId: OTHER, isActive: true },
    { id: VENUE, tenantId: TENANT, isActive: false }])("rejects invalid venue %s", async venue => {
    mocks.venue.mockResolvedValue(venue)
    await expect(updateMatch(MATCH, { venueId: VENUE })).rejects.toThrow("Venue is unavailable")
    noWrites()
  })
  it("revalidates stored references even when the patch only changes an umpire", async () => {
    mocks.match.mockResolvedValue({ ...fixture, venueId: VENUE })
    mocks.venue.mockResolvedValue(undefined)
    await expect(updateMatch(MATCH, { umpire1: "Umpire" })).rejects.toThrow("Venue is unavailable")
    noWrites()
  })
  it("allows explicit clearing of optional resources/date without invalid lookups", async () => {
    mocks.match.mockResolvedValue({ ...fixture, venueId: VENUE, tournamentId: TOURNAMENT, scheduledDate: new Date() })
    await updateMatch(MATCH, { venueId: null, tournamentId: null, scheduledDate: null })
    expect(mocks.set).toHaveBeenCalledWith({ venueId: null, tournamentId: null, scheduledDate: null, updatedAt: expect.any(Date) })
    expect(mocks.venue).not.toHaveBeenCalled()
    // The lock gate still consults the competition the fixture LEAVES
    // (escaping a lock is blocked); requireReferences' FOR SHARE re-check,
    // however, must not run for the explicitly cleared id.
    expect(mocks.tournament).toHaveBeenCalledTimes(1)
    expect(mocks.execute.mock.calls.some(([query]) => dialect.sqlToQuery(query).params.includes(TOURNAMENT))).toBe(false)
  })
  it.each(["toss", "live", "innings_break", "completed", "abandoned", "no_result", "cancelled"])("does not edit %s matches", async status => {
    mocks.match.mockResolvedValue({ ...fixture, status })
    await expect(updateMatch(MATCH, { totalOvers: 10 })).rejects.toThrow("unstarted scheduled")
    noWrites()
  })
  it.each(["toss", "live", "innings_break", "completed", "abandoned", "no_result"])("does not cancel %s matches", async status => {
    mocks.match.mockResolvedValue({ ...fixture, status })
    await expect(deleteMatch(MATCH)).rejects.toThrow("unstarted scheduled")
    noWrites()
  })
  it.each(["startDate", "endDate", "tossWinnerId", "tossDecision", "winnerId", "result", "manOfMatchId"])("protects scheduled rows with legacy %s", async field => {
    mocks.match.mockResolvedValue({ ...fixture, [field]: "existing" })
    await expect(deleteMatch(MATCH)).rejects.toThrow("unstarted scheduled")
    noWrites()
  })
  it.each(historyTables.flatMap(table => ["update", "cancel"].map(command => ({ table, command }))))(
    "blocks $command on legacy $table evidence", async ({ table, command }) => {
    const index = historyTables.indexOf(table)
    mocks.history.mockImplementation(async () => mocks.history.mock.calls.length === index + 1 ? { id: OTHER } : undefined)
    await expect(command === "update" ? updateMatch(MATCH, { teamAId: OTHER }) : deleteMatch(MATCH)).rejects.toThrow("scoring history")
    noWrites()
    expect(mocks.history).toHaveBeenCalledTimes(index + 1)
    for (const [query] of mocks.history.mock.calls) expect(dialect.sqlToQuery(query.where).params).toEqual([MATCH])
  })
  it("cancels instead of cascading a deletion, and ends any active stream", async () => {
    mocks.match.mockResolvedValue({ ...fixture, streamStatus: "live" })
    await deleteMatch(MATCH)
    expect(mocks.set).toHaveBeenCalledWith({ status: "cancelled", streamStatus: "ended", updatedAt: expect.any(Date) })
    expect(mocks.del).not.toHaveBeenCalled()
    expect(mocks.values.mock.calls[0][0]).toMatchObject({ method: "MATCH_CANCEL", payload: { before: { status: "scheduled" }, after: { status: "cancelled" } } })
  })
  it("reauthorizes cancellation retries without a second write/audit", async () => {
    mocks.match.mockResolvedValue({ ...fixture, status: "cancelled" })
    await deleteMatch(MATCH)
    expect(mocks.member).toHaveBeenCalledOnce()
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.insert).not.toHaveBeenCalled()
  })
  it("does not treat a cancelled fixture retry as permission to skip current membership checks", async () => {
    mocks.match.mockResolvedValue({ ...fixture, status: "cancelled" })
    mocks.member.mockResolvedValue({ ...member, status: "suspended" })
    await expect(deleteMatch(MATCH)).rejects.toThrow("access changed")
    noWrites()
  })
})

describe("Bounded input validation", () => {
  it.each(["not a date", "2026-02-30T12:00", "2025-02-29T12:00", "2026-13-01T12:00", "2026-10-20T24:00", "2026-10-20T12:60", "2026-10-20T12:00:60Z"])(
    "rejects malformed/rolled-over schedule %s before SQL", async scheduledDate => {
      await expect(updateMatch(MATCH, { scheduledDate })).rejects.toThrow()
      expect(mocks.transaction).not.toHaveBeenCalled()
    },
  )
  it.each(["2028-02-29T12:30", "2026-10-20T12:00:30.123Z", "2026-10-20T12:30:00+05:00"])("accepts supported schedule %s", async scheduledDate => {
    await updateMatch(MATCH, { scheduledDate })
    expect(mocks.set.mock.calls[0][0].scheduledDate).toEqual(new Date(scheduledDate))
  })
  it.each([0, -1, 1.1, 2147483648])("rejects invalid PostgreSQL match number %s", async matchNumber => {
    await expect(createMatch({ ...metadata, matchNumber })).rejects.toThrow()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
  it.each(["scorerId", "backupScorerId", "status", "id", "createdBy", "liveStreamUrl", "winnerId", "__extra"])("does not mass-assign %s on create", async field => {
    await expect(createMatch({ ...metadata, [field]: OTHER } as never)).rejects.toThrow()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
  it("rejects client tenant substitution rather than silently overwriting it", async () => {
    await expect(createMatch({ ...metadata, tenantId: OTHER })).rejects.toThrow("Invalid tenant")
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
})

describe("Stream plan, phase and audit boundary", () => {
  it("uses the current locked league plan, not the owned league's plan", async () => {
    await startStream(MATCH, "youtube", "https://youtu.be/example")
    expect(mocks.plan).toHaveBeenCalledWith({ plan: "pro", feature: "liveStreaming", label: "Live streaming" })
    expect(mocks.plan.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.execute.mock.invocationCallOrder[3])
    expect(JSON.stringify(mocks.values.mock.calls[0][0])).not.toContain("https://")
  })
  it("propagates a structured plan error with no write", async () => {
    const error = Object.assign(new Error("Upgrade required"), { code: "PLAN_LIMIT" })
    mocks.plan.mockImplementation(() => { throw error })
    await expect(startStream(MATCH, "youtube", "https://youtu.be/example")).rejects.toBe(error)
    noWrites()
  })
  it("allows ending a stream after a plan downgrade and match completion", async () => {
    mocks.match.mockResolvedValue({ ...fixture, status: "completed", streamStatus: "live" })
    mocks.league.mockResolvedValue({ id: TENANT, isActive: true, plan: "free" })
    await endStream(MATCH)
    expect(mocks.plan).not.toHaveBeenCalled()
    expect(mocks.set).toHaveBeenCalledWith({ streamStatus: "ended", updatedAt: expect.any(Date) })
  })
  it.each(["completed", "cancelled", "abandoned", "no_result"])("cannot start a stream for %s matches", async status => {
    mocks.match.mockResolvedValue({ ...fixture, status })
    await expect(startStream(MATCH, "youtube", "https://youtu.be/example")).rejects.toThrow("ended match")
    noWrites()
  })
  it.each(["javascript:alert(1)", "http://example.com/live", "https://user:pass@example.com/live", "file:///live"])("rejects unsafe stream URL %s before SQL", async url => {
    await expect(startStream(MATCH, "youtube", url)).rejects.toThrow()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
  it("reauthorizes an identical start retry without a second write or audit", async () => {
    mocks.match.mockResolvedValue({ ...fixture, streamStatus: "live", streamSource: "youtube", liveStreamUrl: "https://youtu.be/example" })
    await startStream(MATCH, "youtube", "https://youtu.be/example")
    expect(mocks.member).toHaveBeenCalledOnce()
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.insert).not.toHaveBeenCalled()
  })
  it("reauthorizes an ended-stream retry without duplicate audit", async () => {
    mocks.match.mockResolvedValue({ ...fixture, streamStatus: "ended" })
    await endStream(MATCH)
    expect(mocks.member).toHaveBeenCalledOnce()
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.insert).not.toHaveBeenCalled()
  })
  it("still refuses a revoked member's ended-stream retry", async () => {
    mocks.match.mockResolvedValue({ ...fixture, streamStatus: "ended" })
    mocks.member.mockResolvedValue(null)
    await expect(endStream(MATCH)).rejects.toThrow("access changed")
    noWrites()
  })
})

describe("Active-league match read and picker boundaries", () => {
  it("scopes detail by ID and exact tenant after explicit permission", async () => {
    await getMatch(MATCH)
    expect(mocks.permission).toHaveBeenCalledWith("match:read", TENANT)
    expect(dialect.sqlToQuery(mocks.readWhere.mock.calls[0][0]).params).toEqual([MATCH, TENANT])
    expect(mocks.context).toHaveBeenCalledWith({ userId: "clerk", tenantId: TENANT }, expect.any(Function))
    expect(mocks.fallback).not.toHaveBeenCalled()
  })
  it("uses identical exact-tenant filters for list and total count", async () => {
    await getMatches({ tournamentId: TOURNAMENT, teamId: A, status: "scheduled", page: 2, pageSize: 20,
      sortBy: "scheduledDate", sortOrder: "desc" })
    expect(mocks.readWhere).toHaveBeenCalledTimes(2)
    const queries = mocks.readWhere.mock.calls.map(([query]) => dialect.sqlToQuery(query))
    expect(queries[0]).toEqual(queries[1])
    expect(queries[0].params).toEqual([TENANT, TOURNAMENT, A, A, "scheduled"])
    expect(mocks.offset).toHaveBeenCalledWith(20)
  })
  it("rejects a client-supplied foreign read tenant before querying", async () => {
    await expect(getMatches({ tenantId: OTHER } as never)).rejects.toThrow("Invalid tenant")
    expect(mocks.select).not.toHaveBeenCalled()
  })
  it.each(["create", "update"] as const)("scopes %s form options to active-league active teams/open tournaments", async intent => {
    await getMatchFormOptions(intent)
    expect(mocks.permission).toHaveBeenCalledWith(`match:${intent}`, TENANT)
    const queries = mocks.readWhere.mock.calls.map(([query]) => dialect.sqlToQuery(query))
    expect(queries[0].params).toEqual([TENANT, true])
    expect(queries[1].params).toEqual([TENANT, "draft", "registration", "live"])
    expect(mocks.fallback).not.toHaveBeenCalled()
  })
  it("scopes all full-scorecard reads to the same active league as match detail", async () => {
    await getFullScorecard(MATCH)
    expect(mocks.permission).toHaveBeenCalledWith("scorecard:read", TENANT)
    expect(mocks.readWhere).toHaveBeenCalledTimes(3)
    const queries = mocks.readWhere.mock.calls.map(([query]) => dialect.sqlToQuery(query))
    expect(queries[0].params).toEqual([MATCH, TENANT, MATCH, TENANT])
    expect(queries[1].params).toEqual([MATCH, TENANT, MATCH, TENANT])
    expect(queries[2].params).toEqual([MATCH, TENANT])
    expect(mocks.match).toHaveBeenCalledOnce()
    expect(mocks.fallback).not.toHaveBeenCalled()
  })
  it.each([() => getMatch(MATCH), () => getMatches({} as never), () => getMatchFormOptions("create"),
    () => getFullScorecard(MATCH)])("rejects denied exact-tenant permission before any data read", async read => {
    mocks.permission.mockImplementation(async (_permission, tenantId) => { if (tenantId) throw new Error("Forbidden") })
    await expect(read()).rejects.toThrow("Forbidden")
    expect(mocks.select).not.toHaveBeenCalled()
  })
})

describe("Reschedule command (COMP-07 conflict/rest checks)", () => {
  beforeEach(() => {
    // The reschedule branch reads the league's fixtures through the shared
    // select harness; the default readWhere resolution carries no fixture
    // fields, so findSchedulingConflicts sees none (no conflicts).
  })

  it("moves an unstarted fixture and audits MATCH_RESCHEDULE", async () => {
    const result = await rescheduleMatch(MATCH, { scheduledDate: "2026-11-01T15:00:00Z" })

    expect(result).toMatchObject({ success: true })
    const setValues = mocks.set.mock.calls.at(-1)![0]
    expect(setValues.scheduledDate).toEqual(new Date("2026-11-01T15:00:00.000Z"))
    expect(mocks.values.mock.calls.at(-1)![0]).toMatchObject({ method: "MATCH_RESCHEDULE",
      tenantId: TENANT, actorId: ACTOR, actorRole: "league_owner" })
    expect(mocks.permission).toHaveBeenCalledWith("match:update", TENANT)
  })

  it("blocks on team rest conflicts without updating or auditing", async () => {
    mocks.readWhere.mockReturnValueOnce({
      then: (resolve: (value: unknown) => unknown) => resolve([{
        matchId: OTHER, teamAId: A, teamBId: OTHER, venueId: null,
        scheduledDate: new Date("2026-11-01T16:00:00.000Z"), status: "scheduled",
      }]),
    })

    await expect(rescheduleMatch(MATCH, { scheduledDate: "2026-11-01T15:00:00Z" }))
      .rejects.toThrow("a participating team already has a fixture within the rest window")
    noWrites()
  })

  it("blocks on venue reuse and audits nothing", async () => {
    mocks.match.mockResolvedValue({ ...fixture, venueId: VENUE })
    mocks.readWhere.mockReturnValueOnce({
      then: (resolve: (value: unknown) => unknown) => resolve([{
        matchId: OTHER, teamAId: OTHER, teamBId: OTHER, venueId: VENUE,
        scheduledDate: new Date("2026-11-01T15:30:00.000Z"), status: "scheduled",
      }]),
    })

    await expect(rescheduleMatch(MATCH, { scheduledDate: "2026-11-01T15:00:00Z" }))
      .rejects.toThrow("the venue is already in use within the rest window")
    noWrites()
  })

  it("only reschedules an unstarted scheduled fixture", async () => {
    mocks.match.mockResolvedValue({ ...fixture, status: "completed" })
    await expect(rescheduleMatch(MATCH, { scheduledDate: "2026-11-01T15:00:00Z" }))
      .rejects.toThrow("Only an unstarted scheduled fixture")
    noWrites()
  })
})

describe("Competition lock enforcement (COMP-07)", () => {
  const lockedTournament = { id: TOURNAMENT, tenantId: TENANT, status: "live", competitionLockedAt: new Date("2026-10-17T00:00:00Z") }

  it("blocks creation into and edits within a locked competition", async () => {
    mocks.match.mockResolvedValue({ ...fixture, tournamentId: TOURNAMENT })
    mocks.tournament.mockResolvedValue(lockedTournament)
    await expect(createMatch({ ...metadata, tournamentId: TOURNAMENT })).rejects.toThrow(COMPETITION_LOCKED_MESSAGE)
    await expect(updateMatch(MATCH, { umpire1: "Umpire" })).rejects.toThrow(COMPETITION_LOCKED_MESSAGE)
    await expect(rescheduleMatch(MATCH, { scheduledDate: "2026-11-01T15:00:00Z" })).rejects.toThrow(COMPETITION_LOCKED_MESSAGE)
    noWrites()
  })

  it("blocks cancellation and both directions of a competition move while locked", async () => {
    mocks.match.mockResolvedValue({ ...fixture, tournamentId: TOURNAMENT })
    mocks.tournament.mockResolvedValue(lockedTournament)
    await expect(deleteMatch(MATCH)).rejects.toThrow(COMPETITION_LOCKED_MESSAGE)
    // Detaching the fixture from the locked competition escapes no gate.
    await expect(updateMatch(MATCH, { tournamentId: null })).rejects.toThrow(COMPETITION_LOCKED_MESSAGE)
    noWrites()
  })

  it("leaves broadcast controls available on a locked competition", async () => {
    mocks.match.mockResolvedValue({ ...fixture, tournamentId: TOURNAMENT })
    mocks.tournament.mockResolvedValue(lockedTournament)
    await expect(startStream(MATCH, "youtube", "https://youtu.be/example")).resolves.toMatchObject({ success: true })
    await expect(endStream(MATCH)).resolves.toMatchObject({ success: true })
    expect(mocks.update).toHaveBeenCalled()
  })

  it("does not consult a competition for a fixture outside any competition", async () => {
    await expect(updateMatch(MATCH, { umpire1: "Umpire" })).resolves.toMatchObject({ success: true })
    // fixture.tournamentId is null: with no competition in scope there is
    // no lock scope and no tournament read at all.
    expect(mocks.tournament).not.toHaveBeenCalled()
  })

  it("fails closed when a locked read is partial rather than opening the gate", async () => {
    // An undefined locked_at (missing column in a partial read) reads as
    // LOCKED — mirroring membershipGrantsAccess's unknown-fails-closed rule.
    mocks.match.mockResolvedValue({ ...fixture, tournamentId: TOURNAMENT })
    mocks.tournament.mockResolvedValue({ id: TOURNAMENT, tenantId: TENANT, status: "live" })
    await expect(rescheduleMatch(MATCH, { scheduledDate: "2026-11-01T15:00:00Z" })).rejects.toThrow(COMPETITION_LOCKED_MESSAGE)
    noWrites()
  })
})
