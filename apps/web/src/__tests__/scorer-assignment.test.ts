import { beforeEach, describe, expect, it, vi } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import { auditLogs, matches } from "@mtk/database"
import { assignScorer, getScorersForTenant, updateMatch } from "@/app/actions/matches"

const mocks = vi.hoisted(() => ({ auth: vi.fn(), permission: vi.fn(), tenant: vi.fn(), myTenant: vi.fn(),
  where: vi.fn(), limit: vi.fn(), set: vi.fn(), updateWhere: vi.fn(), returning: vi.fn(), context: vi.fn(),
  transaction: vi.fn(), execute: vi.fn(), match: vi.fn(), user: vi.fn(), member: vi.fn(), league: vi.fn(),
  update: vi.fn(), directUpdate: vi.fn(), insert: vi.fn(), values: vi.fn(), revalidate: vi.fn(), team: vi.fn(), history: vi.fn() }))
vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }))
vi.mock("@/lib/rbac-server", () => ({ requirePermissionServer: mocks.permission, resolveActiveTenantId: mocks.tenant }))
vi.mock("@/app/actions/tenants", () => ({ getMyTenant: mocks.myTenant }))
vi.mock("@mtk/database", async original => ({
  ...await original<typeof import("@mtk/database")>(), withTenantContext: mocks.context,
  db: { select: vi.fn(() => ({ from: vi.fn(() => ({ where: mocks.where })) })),
    update: mocks.directUpdate, transaction: mocks.transaction },
}))
const MATCH = "00000000-0000-4000-8000-000000000001"
const SCORER = "00000000-0000-4000-8000-000000000002"
const BACKUP = "00000000-0000-4000-8000-000000000004"
const TENANT = "00000000-0000-4000-8000-000000000003"
const OWNER = "00000000-0000-4000-8000-000000000009"
const dialect = new PgDialect()
const fixture = { id: MATCH, tenantId: TENANT, scorerId: null, backupScorerId: null, status: "scheduled",
  teamAId: SCORER, teamBId: BACKUP, tournamentId: null, venueId: null }
const actor = { id: OWNER, clerkId: "clerk", isActive: true }
const ownerMember = { userId: OWNER, tenantId: TENANT, role: "league_owner", status: "active" }
beforeEach(() => {
  vi.resetAllMocks()
  mocks.auth.mockResolvedValue({ userId: "clerk" })
  mocks.tenant.mockResolvedValue(TENANT)
  mocks.myTenant.mockResolvedValue({ id: TENANT })
  mocks.permission.mockResolvedValue(undefined)
  mocks.context.mockImplementation(async (_context, run) => run())
  mocks.match.mockResolvedValue(fixture)
  mocks.user.mockImplementation(async ({ where }) => {
    const [id] = dialect.sqlToQuery(where).params
    return id === "clerk" || id === OWNER ? actor : { id, isActive: true }
  })
  mocks.member.mockImplementation(async ({ where }) => {
    const [id] = dialect.sqlToQuery(where).params
    return id === OWNER ? ownerMember : { userId: id, tenantId: TENANT, role: "scorer", status: "active" }
  })
  mocks.league.mockResolvedValue({ id: TENANT, isActive: true })
  mocks.execute.mockResolvedValue([])
  mocks.team.mockImplementation(async ({ where }) => ({ id: dialect.sqlToQuery(where).params[0], tenantId: TENANT, isActive: true }))
  mocks.history.mockResolvedValue(undefined)
  mocks.update.mockReturnValue({ set: mocks.set })
  mocks.directUpdate.mockReturnValue({ set: mocks.set })
  mocks.set.mockReturnValue({ where: mocks.updateWhere })
  mocks.updateWhere.mockReturnValue({ returning: mocks.returning })
  mocks.returning.mockImplementation(async () => [{ ...fixture, ...mocks.set.mock.calls.at(-1)![0] }])
  mocks.insert.mockReturnValue({ values: mocks.values })
  mocks.values.mockResolvedValue(undefined)
  mocks.transaction.mockImplementation(async run => run({ execute: mocks.execute,
    query: { matches: { findFirst: mocks.match }, users: { findFirst: mocks.user },
      tenants: { findFirst: mocks.league }, userTenantRoles: { findFirst: mocks.member }, teams: { findFirst: mocks.team },
      ...Object.fromEntries(["matchInnings", "matchBalls", "scoringEvents", "scorecardProjections", "battingScorecards",
        "bowlingScorecards", "fieldingScorecards"].map(name => [name, { findFirst: mocks.history }])) },
    update: mocks.update, insert: mocks.insert,
  }))
  mocks.where.mockReturnValue({ limit: mocks.limit })
  mocks.limit.mockResolvedValue([])
})

function expectNoWrites() {
  expect(mocks.update).not.toHaveBeenCalled()
  expect(mocks.directUpdate).not.toHaveBeenCalled()
  expect(mocks.insert).not.toHaveBeenCalled()
  expect(mocks.revalidate).not.toHaveBeenCalled()
}

describe("Transactional primary/backup scorer assignment", () => {
  it.each(["primary", "backup"] as const)("sets %s only, with an atomic before/after audit", async slot => {
    const result = await assignScorer(MATCH, slot, SCORER)
    const field = slot === "primary" ? "scorerId" : "backupScorerId"
    expect(result).toMatchObject({ success: true, match: { [field]: SCORER } })
    expect(mocks.permission).toHaveBeenCalledWith("match:update", TENANT)
    expect(mocks.context).toHaveBeenCalledWith({ userId: "clerk", tenantId: TENANT }, expect.any(Function))
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "read committed" })
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith(matches)
    expect(mocks.directUpdate).not.toHaveBeenCalled()
    expect(mocks.set).toHaveBeenCalledWith({ [field]: SCORER, updatedAt: expect.any(Date) })
    expect(dialect.sqlToQuery(mocks.updateWhere.mock.calls[0][0]).params).toEqual([MATCH, TENANT])
    expect(mocks.insert).toHaveBeenCalledExactlyOnceWith(auditLogs)
    expect(mocks.values).toHaveBeenCalledWith(expect.objectContaining({ tenantId: TENANT, actorId: OWNER,
      actorRole: "league_owner", method: "MATCH_SCORER_ASSIGN", payload: {
        matchId: MATCH, slot, before: { scorerId: null, backupScorerId: null },
        after: { scorerId: null, backupScorerId: null, [field]: SCORER },
      } }))
    expect(mocks.revalidate).toHaveBeenCalledWith("/dashboard", "layout")
    expect(mocks.revalidate).toHaveBeenCalledWith(`/matches/${MATCH}/scoring`)
  })
  it("locks match then sorted users, league and sorted memberships before reauthorization", async () => {
    await assignScorer(MATCH, "backup", BACKUP)
    const locks = mocks.execute.mock.calls.map(([query]) => dialect.sqlToQuery(query))
    expect(locks).toHaveLength(4)
    expect(locks[0].params).toEqual([MATCH, TENANT])
    expect(locks[0].sql).toContain("FOR UPDATE")
    expect(locks[1].params).toEqual([OWNER, BACKUP].sort())
    expect(locks[1].sql).toContain("ORDER BY")
    expect(locks[1].sql).toContain("FOR UPDATE")
    expect(locks[2].params).toEqual([TENANT])
    expect(locks[2].sql).toContain("FOR SHARE")
    expect(locks[3].params).toEqual([TENANT, ...[OWNER, BACKUP].sort()])
    expect(locks[3].sql).toContain("ORDER BY")
    expect(locks[3].sql).toContain("FOR UPDATE")
    expect(mocks.match.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.execute.mock.invocationCallOrder[0])
    expect(mocks.user.mock.invocationCallOrder[1]).toBeGreaterThan(mocks.execute.mock.invocationCallOrder[3])
    expect(mocks.member.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.execute.mock.invocationCallOrder[3])
    expect(mocks.update.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.member.mock.invocationCallOrder[1])
  })
  it("rejects placing the same person in both slots using the locked match", async () => {
    mocks.match.mockResolvedValue({ ...fixture, scorerId: SCORER })
    await expect(assignScorer(MATCH, "backup", SCORER)).rejects.toThrow("different people")
    expectNoWrites()
  })
  it.each([null, { ...fixture, id: BACKUP }, { ...fixture, tenantId: BACKUP }])("rejects foreign/missing matches %s", async match => {
    mocks.match.mockResolvedValue(match)
    await expect(assignScorer(MATCH, "primary", SCORER)).rejects.toThrow("Match not found")
    expectNoWrites()
  })
  it.each([null, { id: BACKUP, isActive: true }, { id: SCORER, isActive: false }])("rejects invalid candidate account %s", async account => {
    mocks.user.mockReset().mockResolvedValueOnce(actor).mockResolvedValueOnce(actor).mockResolvedValueOnce(account)
    await expect(assignScorer(MATCH, "primary", SCORER)).rejects.toThrow("active scorer in this tenant")
    expectNoWrites()
  })
  it.each([null, { userId: BACKUP }, { tenantId: BACKUP }, { status: "suspended" }, { status: "pending" },
    { expiresAt: "2020-01-01T00:00:00.000Z" }, { expiresAt: "not-a-date" },
    ...["fan", "coach", "team_manager", "league_owner", "super_admin"].map(role => ({ role }))])(
    "rejects invalid candidate membership %s", async change => {
      mocks.member.mockReset().mockResolvedValueOnce(ownerMember).mockResolvedValueOnce(change === null ? null
        : { userId: SCORER, tenantId: TENANT, status: "active", role: "scorer", ...change })
      await expect(assignScorer(MATCH, "primary", SCORER)).rejects.toThrow("active scorer in this tenant")
      expectNoWrites()
    },
  )
  it.each([null, { isActive: false }, { clerkId: "remapped" }, { id: BACKUP }])("rechecks actor account/session %s", async change => {
    mocks.user.mockReset().mockResolvedValueOnce(actor).mockResolvedValueOnce(change === null ? null : { ...actor, ...change })
    await expect(assignScorer(MATCH, "primary", SCORER)).rejects.toThrow("access changed")
    expectNoWrites()
  })
  it.each([null, { status: "suspended" }, { tenantId: BACKUP }, { userId: BACKUP },
    ...["scorer", "team_manager", "super_admin"].map(role => ({ role }))])("rechecks actor membership %s", async change => {
    mocks.member.mockResolvedValueOnce(change === null ? null : { ...ownerMember, ...change })
    await expect(assignScorer(MATCH, "primary", SCORER)).rejects.toThrow("access changed")
    expectNoWrites()
  })
  it.each([null, { id: BACKUP, isActive: true }, { id: TENANT, isActive: false }])("rechecks active league %s", async league => {
    mocks.league.mockResolvedValue(league)
    await expect(assignScorer(MATCH, "primary", SCORER)).rejects.toThrow("access changed")
    expectNoWrites()
  })
  it.each(["primary", "backup"] as const)("clears %s without validating an already-revoked old scorer", async slot => {
    mocks.match.mockResolvedValue({ ...fixture, scorerId: SCORER, backupScorerId: BACKUP })
    await assignScorer(MATCH, slot, null)
    expect(mocks.user).toHaveBeenCalledTimes(2) // actor discovery + locked actor only
    expect(mocks.member).toHaveBeenCalledTimes(1)
    expect(mocks.set).toHaveBeenCalledWith({ [slot === "primary" ? "scorerId" : "backupScorerId"]: null, updatedAt: expect.any(Date) })
  })
  it("does not rewrite or audit an unchanged, still-authorized assignment", async () => {
    mocks.match.mockResolvedValue({ ...fixture, scorerId: SCORER })
    await expect(assignScorer(MATCH, "primary", SCORER)).resolves.toMatchObject({ success: true })
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.insert).not.toHaveBeenCalled()
    expect(mocks.member).toHaveBeenCalledTimes(2)
  })
  it("rejects a lost update without auditing success", async () => {
    mocks.returning.mockResolvedValue([])
    await expect(assignScorer(MATCH, "primary", SCORER)).rejects.toThrow("Match changed")
    expect(mocks.insert).not.toHaveBeenCalled()
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
  it("propagates audit failure before success/cache invalidation", async () => {
    mocks.values.mockRejectedValue(new Error("Audit unavailable"))
    await expect(assignScorer(MATCH, "primary", SCORER)).rejects.toThrow("Audit unavailable")
    expect(mocks.revalidate).not.toHaveBeenCalled()
  })
  it.each(["primary", "backup"])("rejects malformed IDs for %s", async slot => {
    await expect(assignScorer(MATCH, slot as never, "bad-id")).rejects.toThrow()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
  it("rejects an unknown slot before a transaction", async () => {
    await expect(assignScorer(MATCH, "tertiary" as never, SCORER)).rejects.toThrow()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
  it("lists scorers using the exact active membership contract", async () => {
    mocks.where.mockResolvedValue([])
    await getScorersForTenant()
    const predicate = dialect.sqlToQuery(mocks.where.mock.calls[0][0])
    expect(predicate.params).toEqual([TENANT])
    expect(predicate.sql).toContain('"status" = \'active\'')
    expect(predicate.sql).toContain('"users"."is_active" = true')
  })
})

describe("Generic match edit cannot bypass assignment commands", () => {
  it.each(["scorerId", "backupScorerId", "tenantId", "id", "createdBy", "status"])("rejects unexpected field %s", async field => {
    await expect(updateMatch(MATCH, { [field]: SCORER } as never)).rejects.toThrow()
    expectNoWrites()
  })
  it("updates allowlisted metadata without defaulting omitted fields or rewriting scorer slots", async () => {
    await updateMatch(MATCH, { umpire1: "Umpire" })
    expect(mocks.set).toHaveBeenCalledExactlyOnceWith({ umpire1: "Umpire", updatedAt: expect.any(Date) })
  })
  it("accepts the existing edit form payload including nullable umpires and scheduled-date conversion", async () => {
    mocks.where.mockResolvedValue([{ id: SCORER }, { id: BACKUP }])
    const input = { teamAId: SCORER, teamBId: BACKUP, matchFormat: "t20" as const,
      matchType: "friendly" as const, totalOvers: 20, scheduledDate: "2026-10-20T14:00:00Z", umpire1: null, umpire2: null }
    await updateMatch(MATCH, input)
    expect(mocks.set).toHaveBeenCalledExactlyOnceWith({ ...input,
      scheduledDate: new Date(input.scheduledDate), updatedAt: expect.any(Date) })
  })
})
