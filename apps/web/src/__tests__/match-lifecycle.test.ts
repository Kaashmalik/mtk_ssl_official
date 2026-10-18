import { beforeEach, describe, expect, it, vi } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import { matches, auditLogs } from "@mtk/database"
import { setTossResult, startMatch, endMatch } from "@/app/actions/matches"
import { HANDOVER_RESYNC_COPY } from "@/lib/scoring-fence"

const mocks = vi.hoisted(() => ({ auth: vi.fn(), tenant: vi.fn(), permission: vi.fn(), fallback: vi.fn(),
  transaction: vi.fn(), execute: vi.fn(), match: vi.fn(), user: vi.fn(), league: vi.fn(), member: vi.fn(), team: vi.fn(),
  update: vi.fn(), set: vi.fn(), where: vi.fn(), returning: vi.fn(), insert: vi.fn(), values: vi.fn(), revalidate: vi.fn(),
  access: vi.fn(), actor: vi.fn(), complete: vi.fn(), directUpdate: vi.fn() }))
vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }))
vi.mock("@/app/actions/tenants", () => ({ getMyTenant: mocks.fallback }))
vi.mock("@/lib/rbac-server", () => ({ resolveActiveTenantId: mocks.tenant, requirePermissionServer: mocks.permission }))
vi.mock("@/lib/scoring-access", () => ({ requireMatchScoringAccess: mocks.access, requireScoringActorId: mocks.actor }))
vi.mock("@/lib/scoring-service-client", () => ({ proxyCompleteMatch: mocks.complete }))
vi.mock("@mtk/database", async original => ({ ...await original<typeof import("@mtk/database")>(),
  db: { transaction: mocks.transaction, update: mocks.directUpdate } }))

const TENANT = "00000000-0000-4000-8000-000000000001"
const MATCH = "00000000-0000-4000-8000-000000000002"
const ACTOR = "00000000-0000-4000-8000-000000000003"
const A = "00000000-0000-4000-8000-000000000004"
const B = "00000000-0000-4000-8000-000000000005"
const PLAYER = "00000000-0000-4000-8000-000000000006"
const fixture = { id: MATCH, tenantId: TENANT, status: "scheduled", teamAId: A, teamBId: B,
  scorerId: ACTOR, backupScorerId: null, tossWinnerId: null, tossDecision: null, startDate: null }
const account = { id: ACTOR, clerkId: "clerk", isActive: true }
const member = { userId: ACTOR, tenantId: TENANT, role: "scorer", status: "active" }
const dialect = new PgDialect()
const operations = ["toss", "start"] as const
function run(operation: string) { return operation === "toss" ? setTossResult(MATCH, A, "bat") : startMatch(MATCH) }
function noWrites() {
  expect(mocks.update).not.toHaveBeenCalled()
  expect(mocks.directUpdate).not.toHaveBeenCalled()
  expect(mocks.insert).not.toHaveBeenCalled()
  expect(mocks.revalidate).not.toHaveBeenCalled()
}
beforeEach(() => {
  vi.resetAllMocks()
  mocks.auth.mockResolvedValue({ userId: "clerk" })
  mocks.tenant.mockResolvedValue(TENANT)
  mocks.fallback.mockImplementation(() => { throw new Error("Do not use fallback league") })
  mocks.permission.mockResolvedValue(undefined)
  mocks.execute.mockResolvedValue([])
  mocks.match.mockResolvedValue(fixture)
  mocks.user.mockResolvedValue(account)
  mocks.member.mockResolvedValue(member)
  mocks.league.mockResolvedValue({ id: TENANT, isActive: true })
  mocks.team.mockImplementation(async ({ where }) => ({ id: dialect.sqlToQuery(where).params[0], tenantId: TENANT, isActive: true }))
  mocks.update.mockReturnValue({ set: mocks.set })
  mocks.set.mockReturnValue({ where: mocks.where })
  mocks.where.mockReturnValue({ returning: mocks.returning })
  mocks.returning.mockImplementation(async () => [{ ...fixture, ...mocks.set.mock.calls.at(-1)![0] }])
  mocks.insert.mockReturnValue({ values: mocks.values })
  mocks.values.mockResolvedValue(undefined)
  mocks.transaction.mockImplementation(async fn => fn({ execute: mocks.execute,
    query: { matches: { findFirst: mocks.match }, users: { findFirst: mocks.user }, tenants: { findFirst: mocks.league },
      userTenantRoles: { findFirst: mocks.member }, teams: { findFirst: mocks.team } },
    update: mocks.update, insert: mocks.insert,
  }))
  mocks.access.mockResolvedValue(fixture)
  mocks.actor.mockResolvedValue(ACTOR)
  mocks.complete.mockResolvedValue({ success: true, matchId: MATCH, status: "completed" })
})

describe.each(operations)("Locked %s authorization and lifecycle", operation => {
  it.each(["primary", "backup", "owner"])("allows current %s authority with atomic audit", async role => {
    if (role === "backup") mocks.match.mockResolvedValue({ ...fixture, scorerId: PLAYER, backupScorerId: ACTOR })
    if (role === "owner") {
      mocks.member.mockResolvedValue({ ...member, role: "league_owner" })
      mocks.match.mockResolvedValue({ ...fixture, scorerId: null })
    }
    await expect(run(operation)).resolves.toMatchObject({ success: true })
    expect(mocks.fallback).not.toHaveBeenCalled()
    expect(mocks.permission).toHaveBeenCalledWith("match:score", TENANT)
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "read committed" })
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith(matches)
    expect(dialect.sqlToQuery(mocks.where.mock.calls[0][0]).params).toEqual([MATCH, TENANT])
    expect(mocks.insert).toHaveBeenCalledExactlyOnceWith(auditLogs)
    expect(mocks.values).toHaveBeenCalledWith(expect.objectContaining({ tenantId: TENANT, actorId: ACTOR,
      method: operation === "toss" ? "MATCH_TOSS_SET" : "MATCH_START",
      payload: expect.objectContaining({ matchId: MATCH, before: expect.objectContaining({ status: "scheduled" }),
        after: expect.objectContaining({ status: operation === "toss" ? "toss" : "live" }) }) }))
    expect(mocks.directUpdate).not.toHaveBeenCalled()
  })
  it("locks match -> account -> league -> membership -> sorted teams before writes", async () => {
    await run(operation)
    const locks = mocks.execute.mock.calls.map(([query]) => dialect.sqlToQuery(query))
    expect(locks.map(lock => lock.params)).toEqual([[MATCH, TENANT], [ACTOR], [TENANT], [ACTOR, TENANT], [TENANT, A, B]])
    expect(locks[0].sql).toContain("FOR UPDATE")
    expect(locks[1].sql).toContain("FOR UPDATE")
    expect(locks.slice(2).every(lock => lock.sql.includes("FOR SHARE"))).toBe(true)
    expect(locks[4].sql).toContain("ORDER BY")
    expect(mocks.user.mock.invocationCallOrder[1]).toBeGreaterThan(mocks.execute.mock.invocationCallOrder[3])
    expect(mocks.team.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.execute.mock.invocationCallOrder[4])
    expect(mocks.member.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.execute.mock.invocationCallOrder[3])
  })
  it.each([null, { status: "suspended" }, { status: "pending" }, { userId: B }, { tenantId: B },
    ...["fan", "coach", "team_manager", "super_admin"].map(role => ({ role }))])("rejects revoked/foreign membership %s", async change => {
    mocks.member.mockResolvedValue(change === null ? null : { ...member, ...change })
    await expect(run(operation)).rejects.toThrow("access changed")
    noWrites()
  })
  it("rejects a scorer assigned to neither slot", async () => {
    mocks.match.mockResolvedValue({ ...fixture, scorerId: PLAYER, backupScorerId: null })
    await expect(run(operation)).rejects.toThrow("access changed")
    noWrites()
  })
  it.each([null, { id: B }, { clerkId: null }, { clerkId: "remapped" }, { isActive: false }])("rechecks locked account/session %s", async change => {
    mocks.user.mockReset().mockResolvedValueOnce(account).mockResolvedValueOnce(change === null ? null : { ...account, ...change })
    await expect(run(operation)).rejects.toThrow("access changed")
    noWrites()
  })
  it.each([null, { id: B, isActive: true }, { id: TENANT, isActive: false }])("rejects foreign/inactive league %s", async league => {
    mocks.league.mockResolvedValue(league)
    await expect(run(operation)).rejects.toThrow("access changed")
    noWrites()
  })
  it.each([null, { ...fixture, id: B }, { ...fixture, tenantId: B }])("rejects foreign/missing match %s", async match => {
    mocks.match.mockResolvedValue(match)
    await expect(run(operation)).rejects.toThrow("Match not found")
    noWrites()
  })
  it.each([null, { id: A, tenantId: B, isActive: true }, { id: B, tenantId: TENANT, isActive: true },
    { id: A, tenantId: TENANT, isActive: false }])("rejects unavailable/foreign match team %s", async team => {
    mocks.team.mockResolvedValue(team)
    await expect(run(operation)).rejects.toThrow("team is unavailable")
    noWrites()
  })
  it.each(["completed", "cancelled", "abandoned", "no_result", "innings_break"])("does not rewind %s matches", async status => {
    mocks.match.mockResolvedValue({ ...fixture, status })
    await expect(run(operation)).rejects.toThrow()
    noWrites()
  })
  it("fails on a lost conditional write without auditing success", async () => {
    mocks.returning.mockResolvedValue([])
    await expect(run(operation)).rejects.toThrow("Match changed")
    expect(mocks.insert).not.toHaveBeenCalled()
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
  it("propagates audit failure before cache invalidation/success", async () => {
    mocks.values.mockRejectedValue(new Error("Audit unavailable"))
    await expect(run(operation)).rejects.toThrow("Audit unavailable")
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
})

describe("Lifecycle command validation and retry semantics", () => {
  it("does not replace the original live start timestamp on retry", async () => {
    const startDate = new Date("2026-10-15T12:00:00Z")
    mocks.match.mockResolvedValue({ ...fixture, status: "live", startDate })
    expect(await startMatch(MATCH)).toMatchObject({ match: { startDate } })
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.insert).not.toHaveBeenCalled()
  })
  it("does not re-audit an identical toss retry", async () => {
    mocks.match.mockResolvedValue({ ...fixture, status: "toss", tossWinnerId: A, tossDecision: "bat" })
    await setTossResult(MATCH, A, "bat")
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it("cannot rewrite toss while live", async () => {
    mocks.match.mockResolvedValue({ ...fixture, status: "live" })
    await expect(setTossResult(MATCH, A, "bat")).rejects.toThrow("after the match has started")
    noWrites()
  })
  it("rejects third-team toss winner", async () => {
    await expect(setTossResult(MATCH, PLAYER, "bat")).rejects.toThrow("match team")
    noWrites()
  })
  it.each([() => startMatch("bad"), () => setTossResult(MATCH, "bad", "bat"),
    () => setTossResult(MATCH, A, "invalid" as never)])("rejects malformed command before SQL", async command => {
    await expect(command()).rejects.toThrow()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
})

describe("Canonical match completion bridge", () => {
  it("echoes the dashboard's observed handover epoch", async () => {
    await endMatch(MATCH, A, "Won", PLAYER, 8)
    expect(mocks.complete).toHaveBeenCalledWith(MATCH, expect.objectContaining({ handoverEpoch: 8 }), TENANT, ACTOR)
  })
  it("returns an expected fencing failure without falsely reporting completion", async () => {
    mocks.complete.mockRejectedValue(new Error(`Scoring service error (403): ${HANDOVER_RESYNC_COPY}`))
    await expect(endMatch(MATCH, A, "Won", PLAYER, 7)).resolves.toEqual({
      success: false, code: "SCORING_SESSION_FENCED", message: HANDOVER_RESYNC_COPY,
    })
    noWrites()
  })
  it("forwards current tenant/actor and the optional award without a local completion write", async () => {
    await expect(endMatch(MATCH, A, "  Won  ", PLAYER)).resolves.toMatchObject({ success: true, matchId: MATCH })
    expect(mocks.access).toHaveBeenCalledWith("clerk", TENANT, MATCH)
    expect(mocks.actor).toHaveBeenCalledWith("clerk")
    expect(mocks.complete).toHaveBeenCalledWith(MATCH, { winnerId: A, result: "Won", manOfMatchId: PLAYER }, TENANT, ACTOR)
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.directUpdate).not.toHaveBeenCalled()
    expect(mocks.fallback).not.toHaveBeenCalled()
    expect(mocks.revalidate).toHaveBeenCalledWith(`/matches/${MATCH}/live`)
    // PUB-06: the public match detail page shows the completed result.
    expect(mocks.revalidate).toHaveBeenCalledWith(`/matches/${MATCH}`)
  })
  it("supports no-winner completion without a fabricated team or award", async () => {
    await endMatch(MATCH, null, "No result", null)
    expect(mocks.complete).toHaveBeenCalledWith(MATCH, { winnerId: undefined, result: "No result", manOfMatchId: undefined }, TENANT, ACTOR)
  })
  it.each(["access", "actor", "complete"] as const)("propagates %s rejection without local fallback or false success", async stage => {
    mocks[stage].mockRejectedValue(new Error("Rejected"))
    await expect(endMatch(MATCH, A, "Won")).rejects.toThrow("Rejected")
    noWrites()
    if (stage !== "complete") expect(mocks.complete).not.toHaveBeenCalled()
  })
  it.each([() => endMatch("bad", A, "Won"), () => endMatch(MATCH, "bad", "Won"),
    () => endMatch(MATCH, A, ""), () => endMatch(MATCH, A, "x".repeat(2001)), () => endMatch(MATCH, A, "Won", "bad")])(
    "rejects malformed completion details before transport", async command => {
      await expect(command()).rejects.toThrow()
      expect(mocks.complete).not.toHaveBeenCalled()
    },
  )
})
