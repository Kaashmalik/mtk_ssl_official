import { beforeEach, describe, expect, it, vi } from "vitest"
import { recordBall, undoBall, createInnings, completeInnings, getMatchPlayersForScoring, type RecordBallInput } from "@/app/actions/scoring"
import { PgDialect } from "drizzle-orm/pg-core"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), resolveTenant: vi.fn(), authorize: vi.fn(), findTenant: vi.fn(),
  limit: vi.fn(), proxy: vi.fn(),
  scoringAccess: vi.fn(), undo: vi.fn(), create: vi.fn(), complete: vi.fn(),
  actor: vi.fn(),
  where: vi.fn(), ordered: vi.fn(),
}))
vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/rbac-server", () => ({
  requirePermissionServer: mocks.authorize,
  resolveActiveTenantId: mocks.resolveTenant,
}))
vi.mock("@/lib/scoring-access", () => ({ requireMatchScoringAccess: mocks.scoringAccess, requireScoringActorId: mocks.actor }))
vi.mock("@/lib/scoring-service-client", () => ({
  proxyRecordBall: mocks.proxy, proxyUndoBall: mocks.undo,
  proxyCreateInnings: mocks.create, proxyCompleteInnings: mocks.complete,
}))
vi.mock("@mtk/database", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mtk/database")>()
  const chain = { from: vi.fn().mockReturnThis(), where: mocks.where.mockReturnThis(), limit: mocks.limit, orderBy: mocks.ordered }
  return { ...actual, db: { select: vi.fn(() => chain), query: { tenants: { findFirst: mocks.findTenant } } } }
})

const MATCH = "00000000-0000-4000-8000-000000000002"
const TENANT = "00000000-0000-4000-8000-000000000001"
const ACTOR = "00000000-0000-4000-8000-000000000006"
function input(overrides: Partial<RecordBallInput> = {}): RecordBallInput {
  return {
    matchId: MATCH, inningsId: "00000000-0000-4000-8000-000000000003",
    batsmanId: "00000000-0000-4000-8000-000000000004",
    bowlerId: "00000000-0000-4000-8000-000000000005", clientOpId: "stable-operation",
    overNumber: 0, ballNumber: 1, runs: 0, isWicket: false, isWide: false,
    isNoBall: false, isBye: false, isLegBye: false, isFour: false, isSix: false,
    ...overrides,
  }
}

describe("Scoring action explicit command bridge", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.limit.mockReset()
    mocks.proxy.mockReset()
    mocks.scoringAccess.mockReset().mockResolvedValue({ id: MATCH, tenantId: TENANT })
    mocks.actor.mockReset().mockResolvedValue(ACTOR)
    mocks.complete.mockResolvedValue({ innings: {}, matchStatus: "innings_break", inningsBreakApplied: true })
    mocks.auth.mockResolvedValue({ userId: "user_clerk" })
    mocks.resolveTenant.mockResolvedValue(TENANT)
    mocks.authorize.mockResolvedValue(undefined)
    mocks.findTenant.mockResolvedValue({ id: TENANT })
    mocks.limit.mockResolvedValue([{ status: "in_progress" }])
    mocks.ordered.mockResolvedValue([])
    mocks.proxy.mockImplementation(async (command) => ({
      ballId: "saved", clientOpId: command.clientOpId,
      scorecard: { matchId: MATCH, innings: 1, totalRuns: 1, totalWickets: 0, overs: 0, balls: 0, runRate: 0 },
    }))
  })

  it.each([
    { values: { runs: 1, isWide: true }, batter: 0, extras: { type: "wide", runs: 1 } },
    { values: { runs: 5, isNoBall: true }, batter: 4, extras: { type: "noball", runs: 1 } },
    { values: { runs: 4, isBye: true }, batter: 0, extras: { type: "bye", runs: 4 } },
    { values: { runs: 2, isLegBye: true }, batter: 0, extras: { type: "legbye", runs: 2 } },
  ])("sends disjoint batter and extra runs for $values", async ({ values, batter, extras }) => {
    const result = await recordBall(input(values))
    expect(mocks.proxy).toHaveBeenCalledWith(expect.objectContaining({
      runs: batter, extras, clientOpId: "stable-operation",
    }), TENANT, ACTOR)
    expect(result.clientOpId).toBe("stable-operation")
  })

  it("rejects contradictory extras rather than silently choosing one", async () => {
    await expect(recordBall(input({ runs: 1, isWide: true, isNoBall: true }))).rejects.toThrow("exactly one")
    expect(mocks.proxy).not.toHaveBeenCalled()
  })

  it("rejects a nonmatching service acknowledgement", async () => {
    mocks.proxy.mockResolvedValue({ ballId: "saved", clientOpId: "wrong" })
    await expect(recordBall(input())).rejects.toThrow("did not acknowledge")
  })

  it("lets the canonical service decide whether a completed match request is a replay", async () => {
    mocks.limit.mockResolvedValueOnce([{ status: "completed" }])
    await recordBall(input())
    expect(mocks.proxy).toHaveBeenCalledOnce()
  })

  it.each(["record", "undo", "create", "complete"])("denies unassigned scorer before %s proxy mutation", async (operation) => {
    mocks.scoringAccess.mockRejectedValue(new Error("Not assigned"))
    const run = () => operation === "record" ? recordBall(input()) : operation === "undo"
      ? undoBall(MATCH, input().inningsId) : operation === "create"
        ? createInnings({ matchId: MATCH, teamId: TENANT, inningsNumber: 1 })
        : completeInnings(MATCH, input().inningsId)
    await expect(run()).rejects.toThrow("Not assigned")
    expect(mocks.scoringAccess).toHaveBeenCalledWith("user_clerk", TENANT, MATCH)
    for (const proxy of [mocks.proxy, mocks.undo, mocks.create, mocks.complete]) expect(proxy).not.toHaveBeenCalled()
  })

  it.each(["record", "undo", "create", "complete"])("forwards only the session-resolved actor for %s", async (operation) => {
    if (operation === "record") {
      await recordBall({ ...input(), actorId: "forged" } as RecordBallInput)
      expect(mocks.proxy.mock.calls[0][2]).toBe(ACTOR)
      expect(mocks.proxy.mock.calls[0][0]).not.toHaveProperty("actorId")
    } else if (operation === "undo") {
      await undoBall(MATCH, input().inningsId)
      expect(mocks.undo).toHaveBeenCalledWith(MATCH, input().inningsId, TENANT, ACTOR)
    } else if (operation === "create") {
      await createInnings({ matchId: MATCH, teamId: TENANT, inningsNumber: 1 })
      expect(mocks.create.mock.calls[0][2]).toBe(ACTOR)
    } else {
      await completeInnings(MATCH, input().inningsId)
      expect(mocks.complete).toHaveBeenCalledWith(MATCH, input().inningsId, TENANT, ACTOR)
    }
    expect(mocks.actor).toHaveBeenCalledWith("user_clerk")
  })

  it.each(["record", "undo", "create", "complete"])("blocks an unavailable actor before %s transport", async (operation) => {
    mocks.actor.mockRejectedValue(new Error("Inactive actor"))
    const run = () => operation === "record" ? recordBall(input()) : operation === "undo"
      ? undoBall(MATCH, input().inningsId) : operation === "create"
        ? createInnings({ matchId: MATCH, teamId: TENANT, inningsNumber: 1 }) : completeInnings(MATCH, input().inningsId)
    await expect(run()).rejects.toThrow("Inactive actor")
    for (const proxy of [mocks.proxy, mocks.undo, mocks.create, mocks.complete]) expect(proxy).not.toHaveBeenCalled()
  })

  it("offers only active, available players from the two tenant-scoped teams", async () => {
    mocks.limit.mockResolvedValueOnce([{ teamAId: input().batsmanId, teamBId: input().bowlerId }])
    await getMatchPlayersForScoring(MATCH)
    const queries = mocks.where.mock.calls.slice(1).map(([where]) => new PgDialect().sqlToQuery(where))
    expect(queries.map((query) => query.params)).toEqual([
      [input().batsmanId, TENANT, true, "active"], [input().bowlerId, TENANT, true, "active"],
    ])
  })
})
