import { beforeEach, describe, expect, it, vi } from "vitest"
import { raiseAwardDispute, resolveAwardDispute } from "@/lib/award-dispute-records"

const mocks = vi.hoisted(() => ({
  fanContext: vi.fn(), ownerContext: vi.fn(), transaction: vi.fn(),
  dbSelect: vi.fn(), dbInsert: vi.fn(),
}))
vi.mock("@/lib/fan-follows", () => ({ requireFanContext: mocks.fanContext }))
vi.mock("@/lib/league-reads", () => ({ requireActiveLeagueContext: mocks.ownerContext }))
vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn(async () => ({ userId: "clerk" })) }))
vi.mock("@/lib/rbac-server", () => ({ requirePermissionServer: vi.fn() }))
// Real tables, real policy, real zod; only the db handle is a mock.
vi.mock("@mtk/database", async (importOriginal) => ({
  ...await importOriginal<typeof import("@mtk/database")>(),
  db: { select: mocks.dbSelect, insert: mocks.dbInsert, transaction: mocks.transaction },
}))

const ACTOR = "00000000-0000-4000-8000-0000000000a1"
const TENANT = "00000000-0000-4000-8000-0000000000b2"
const TOURNAMENT = "00000000-0000-4000-8000-0000000000c3"
const AWARD = "00000000-0000-4000-8000-0000000000d4"
const TEAM = "00000000-0000-4000-8000-0000000000e5"
const OPEN_DISPUTE = "00000000-0000-4000-8000-0000000000f6"
const NEW_DISPUTE = "00000000-0000-4000-8000-0000000000f7"

/**
 * The raise flow runs module-level selects in a fixed order:
 * (1) active award of a same-league tournament (tenant join),
 * (2) approved registrations, (3) the member's player rows,
 * (4) [only when no registered player] registrations registered by the actor,
 * (5) the open-dispute replay check.
 */
function dbMock(specs: unknown[][], { disputeId = NEW_DISPUTE, insertError = null }:
  { disputeId?: string; insertError?: Error | null } = {}) {
  const select = mocks.dbSelect
  for (const rows of specs) {
    const thenable: any = Promise.resolve(rows)
    thenable.limit = () => thenable
    const joinNode: any = { where: () => thenable }
    select.mockImplementationOnce(() => ({
      from: () => ({ where: () => thenable, innerJoin: () => joinNode, leftJoin: () => joinNode }),
    }))
  }
  const values = vi.fn()
  const returning = vi.fn(insertError
    ? async () => { throw insertError }
    : async () => [{ id: disputeId }])
  values.mockReturnValue({ returning })
  mocks.dbInsert.mockReturnValue({ values })
  return { select, values, returning }
}

/** The resolve flow is a single row-locked select, then update + audit insert. */
function txMock(specs: unknown[][]) {
  const select = vi.fn()
  for (const rows of specs) {
    const thenable: any = Promise.resolve(rows)
    thenable.limit = () => thenable
    thenable.for = () => thenable
    select.mockImplementationOnce(() => ({ from: () => ({ where: () => thenable }) }))
  }
  const values = vi.fn()
  const set = vi.fn(() => ({ where: async () => undefined }))
  const update = vi.fn(() => ({ set }))
  const insert = vi.fn(() => ({ values }))
  mocks.transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) =>
    cb({ select, update, set, insert, values }))
  return { select, update, set, insert, values }
}

const raiseValid = { tournamentId: TOURNAMENT, awardId: AWARD, reason: "process_error" as const }

beforeEach(() => {
  vi.resetAllMocks()
  mocks.fanContext.mockResolvedValue({ tenantId: TENANT, actorId: ACTOR, clerkId: "clerk", role: "team_manager" })
  mocks.ownerContext.mockResolvedValue({ tenantId: TENANT, actorId: ACTOR, clerkId: "clerk", role: "league_owner" })
})

describe("Raising an award dispute (member authority, PUB-04)", () => {
  it("records the dispute with full provenance under the member context", async () => {
    const db = dbMock([[{ id: AWARD, tournamentId: TOURNAMENT }], [{ teamId: TEAM }], [{ teamId: TEAM }], []])

    const result = await raiseAwardDispute(raiseValid)

    expect(mocks.fanContext).toHaveBeenCalledWith("tournament:read")
    expect(result).toEqual({ raised: true, disputeId: NEW_DISPUTE })
    expect(db.values).toHaveBeenNthCalledWith(1, expect.objectContaining({
      tenantId: TENANT, tournamentId: TOURNAMENT, awardId: AWARD,
      raisedBy: ACTOR, reason: "process_error",
    }))
    // Second insert is the tenant-scoped audit entry.
    expect(db.values).toHaveBeenNthCalledWith(2, expect.objectContaining({
      method: "AWARD_DISPUTE_RAISED", tenantId: TENANT, actorId: ACTOR,
      actorRole: "team_manager",
      payload: expect.objectContaining({ disputeId: NEW_DISPUTE, awardId: AWARD, reason: "process_error" }),
    }))
  })

  it("accepts a member who registered their team themselves (registeredBy proof)", async () => {
    const db = dbMock([[{ id: AWARD, tournamentId: TOURNAMENT }], [{ teamId: TEAM }], [], [{ id: "reg1" }], []])

    const result = await raiseAwardDispute(raiseValid)

    expect(result.raised).toBe(true)
    expect(db.values).toHaveBeenCalledTimes(2)
  })

  it("is an idempotent replay when this member already has an OPEN dispute", async () => {
    dbMock([[{ id: AWARD, tournamentId: TOURNAMENT }], [{ teamId: TEAM }], [{ teamId: TEAM }],
      [{ id: OPEN_DISPUTE }]])

    const result = await raiseAwardDispute(raiseValid)

    expect(result).toEqual({ raised: false, disputeId: OPEN_DISPUTE })
    expect(mocks.dbInsert).not.toHaveBeenCalled()
  })

  it("resolves the lost race against a concurrent raise as the replay (DB partial unique)", async () => {
    const dup = new Error("duplicate key") as Error & { code?: string }
    dup.code = "23505"
    const db = dbMock(
      [[{ id: AWARD, tournamentId: TOURNAMENT }], [{ teamId: TEAM }], [{ teamId: TEAM }], [], [{ id: OPEN_DISPUTE }]],
      { insertError: dup },
    )

    const result = await raiseAwardDispute(raiseValid)

    expect(result).toEqual({ raised: false, disputeId: OPEN_DISPUTE })
    expect(db.values).not.toHaveBeenCalledWith(expect.objectContaining({ method: "AWARD_DISPUTE_RAISED" }))
  })

  it("refuses a member who is not registered in THAT tournament", async () => {
    dbMock([[{ id: AWARD, tournamentId: TOURNAMENT }], [{ teamId: TEAM }], [], []])

    await expect(raiseAwardDispute(raiseValid))
      .rejects.toThrow("only members registered in this tournament")
    expect(mocks.dbInsert).not.toHaveBeenCalled()
  })

  it("refuses an award that is missing, foreign, or already superseded", async () => {
    const db = dbMock([[], [], [], []])
    await expect(raiseAwardDispute(raiseValid))
      .rejects.toThrow("award not found in this league, or already superseded")
    expect(db.values).not.toHaveBeenCalled()
    expect(mocks.ownerContext).not.toHaveBeenCalled()
  })

  it.each([
    { name: "a free-text reason", input: { ...raiseValid, reason: "grudge" } },
    { name: "an unknown field", input: { ...raiseValid, brief: "long text" } },
    { name: "a malformed award id", input: { ...raiseValid, awardId: "not-a-uuid" } },
  ])("rejects $name before any authority or database work", async ({ input }) => {
    const db = dbMock([])
    await expect(raiseAwardDispute(input as never)).rejects.toThrow()
    expect(mocks.fanContext).not.toHaveBeenCalled()
    expect(db.select).not.toHaveBeenCalled()
    expect(mocks.dbInsert).not.toHaveBeenCalled()
  })
})

describe("Resolving an award dispute (owner authority, never mutating the award)", () => {
  it("records the owner's decision row-locked with full provenance", async () => {
    const tx = txMock([[{ id: OPEN_DISPUTE, status: "open" }]])

    const result = await resolveAwardDispute({ disputeId: OPEN_DISPUTE, decision: "upheld" })

    expect(mocks.ownerContext).toHaveBeenCalledWith("tournament:update")
    expect(result).toEqual({ decided: true, disputeId: OPEN_DISPUTE, decision: "upheld" })
    expect(tx.set).toHaveBeenCalledWith(expect.objectContaining({
      status: "upheld", resolvedAt: expect.any(Date), resolvedBy: ACTOR,
    }))
    expect(tx.values).toHaveBeenCalledWith(expect.objectContaining({
      method: "AWARD_DISPUTE_RESOLVED", tenantId: TENANT, actorId: ACTOR,
      payload: expect.objectContaining({ disputeId: OPEN_DISPUTE, decision: "upheld", awardMutated: false }),
    }))
  })

  it("treats an already-decided dispute as terminal (no re-decision, no audit)", async () => {
    const tx = txMock([[{ id: OPEN_DISPUTE, status: "dismissed" }]])

    const result = await resolveAwardDispute({ disputeId: OPEN_DISPUTE, decision: "upheld" })

    expect(result).toEqual({ decided: false, disputeId: OPEN_DISPUTE, decision: "upheld" })
    expect(tx.update).not.toHaveBeenCalled()
    expect(tx.insert).not.toHaveBeenCalled()
  })

  it("refuses a dispute that is not in the active league", async () => {
    const tx = txMock([[]])
    await expect(resolveAwardDispute({ disputeId: OPEN_DISPUTE, decision: "dismissed" }))
      .rejects.toThrow("dispute not found in this league")
    expect(tx.update).not.toHaveBeenCalled()
  })

  it("never touches the award row — the resolution is the ONLY update+audit", async () => {
    const tx = txMock([[{ id: OPEN_DISPUTE, status: "open" }]])

    await resolveAwardDispute({ disputeId: OPEN_DISPUTE, decision: "dismissed" })

    // Exactly one set (the dispute's decision); no supersede-style
    // award correction can ride along.
    expect(tx.set).toHaveBeenCalledTimes(1)
    expect(tx.set).toHaveBeenCalledWith(expect.not.objectContaining({ supersededAt: expect.anything() }))
  })

  it.each([
    { name: "an invented decision", input: { disputeId: OPEN_DISPUTE, decision: "maybe" } },
    { name: "an unknown field", input: { disputeId: OPEN_DISPUTE, decision: "upheld", note: "..." } },
  ])("rejects $name before any authority or database work", async ({ input }) => {
    const tx = txMock([])
    await expect(resolveAwardDispute(input as never)).rejects.toThrow()
    expect(mocks.ownerContext).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(tx.select).not.toHaveBeenCalled()
  })
})
