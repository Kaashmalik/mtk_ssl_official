import { beforeEach, describe, expect, it, vi } from "vitest"
import { recordBall, type RecordBallInput } from "@/app/actions/scoring"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), resolveTenant: vi.fn(), authorize: vi.fn(), findTenant: vi.fn(),
  limit: vi.fn(), proxy: vi.fn(),
}))
vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/rbac-server", () => ({
  requirePermissionServer: mocks.authorize,
  resolveActiveTenantId: mocks.resolveTenant,
}))
vi.mock("@/lib/scoring-service-client", () => ({ proxyRecordBall: mocks.proxy }))
vi.mock("@mtk/database", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mtk/database")>()
  const chain = { from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), limit: mocks.limit }
  return { ...actual, db: { select: vi.fn(() => chain), query: { tenants: { findFirst: mocks.findTenant } } } }
})

const MATCH = "00000000-0000-4000-8000-000000000002"
const TENANT = "00000000-0000-4000-8000-000000000001"
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
    mocks.auth.mockResolvedValue({ userId: "user_clerk" })
    mocks.resolveTenant.mockResolvedValue(TENANT)
    mocks.authorize.mockResolvedValue(undefined)
    mocks.findTenant.mockResolvedValue({ id: TENANT })
    mocks.limit.mockResolvedValue([]).mockResolvedValueOnce([{ id: MATCH, status: "live" }])
      .mockResolvedValueOnce([{ status: "in_progress" }])
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
    }), TENANT)
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
    mocks.limit.mockReset().mockResolvedValueOnce([{ id: MATCH, status: "completed" }])
      .mockResolvedValueOnce([{ status: "completed" }])
    await recordBall(input())
    expect(mocks.proxy).toHaveBeenCalledOnce()
  })
})
