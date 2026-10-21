import { beforeEach, describe, expect, it, vi } from "vitest"
import { POST } from "@/app/api/mobile/scoring/ball/route"
import { ScoringRevisionConflict } from "@/lib/scoring-revision-client"

/**
 * ENH-03-02: the mobile intake boundary. The serialized delivery that leaves
 * the device — flat booleans today, the LEGACY nested payload (extras/wicket
 * objects, over/ball aliases) for installed clients — must each arrive at the
 * canonical write path as the SAME validated command, with nothing stripped
 * and nothing invented. Queue bookkeeping stays server-owned.
 */

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  resolveTenant: vi.fn(),
  authorize: vi.fn(),
  findTenant: vi.fn(),
  scoringAccess: vi.fn(),
  actor: vi.fn(),
  innings: vi.fn(),
  proxy: vi.fn(),
}))
vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/rbac-server", () => ({
  requirePermissionServer: mocks.authorize,
  resolveActiveTenantId: mocks.resolveTenant,
}))
vi.mock("@/lib/scoring-access", () => ({
  requireMatchScoringAccess: mocks.scoringAccess,
  requireScoringActorId: mocks.actor,
}))
vi.mock("@/lib/scoring-reads", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/scoring-reads")>()
  return { ...actual, findScoringTenant: mocks.findTenant, readInningsForCommand: mocks.innings }
})
vi.mock("@/lib/scoring-service-client", () => ({
  proxyRecordBall: mocks.proxy,
  proxyUndoBall: vi.fn(),
  proxyCreateInnings: vi.fn(),
  proxyCompleteInnings: vi.fn(),
}))

const MATCH = "00000000-0000-4000-8000-000000000002"
const TENANT = "00000000-0000-4000-8000-000000000001"
const ACTOR = "00000000-0000-4000-8000-000000000006"
const BATS = "00000000-0000-4000-8000-000000000004"
const BOWL = "00000000-0000-4000-8000-000000000005"
const FIELDER = "00000000-0000-4000-8000-000000000008"
const NON_STRIKER = "00000000-0000-4000-8000-000000000007"
const INNINGS = "00000000-0000-4000-8000-000000000003"

function requestWith(body: unknown): Request {
  return new Request("http://localhost/api/mobile/scoring/ball", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockResolvedValue({ userId: "user_clerk" })
  mocks.resolveTenant.mockResolvedValue(TENANT)
  mocks.authorize.mockResolvedValue(undefined)
  mocks.findTenant.mockResolvedValue({ id: TENANT })
  mocks.scoringAccess.mockResolvedValue({ id: MATCH, tenantId: TENANT })
  mocks.actor.mockResolvedValue(ACTOR)
  mocks.innings.mockResolvedValue({ id: INNINGS, status: "in_progress", totalBalls: 0 })
  mocks.proxy.mockImplementation(async (command) => ({
    ballId: "saved-ball", clientOpId: command.clientOpId,
    scorecard: { matchId: MATCH, innings: 1, totalRuns: 1, totalWickets: 0, overs: 0, balls: 0, runRate: 0 },
  }))
})

describe("ENH-03-02: mobile delivery intake normalization", () => {
  it("keeps every flat boolean flag of the current device payload through to the backend", async () => {
    const response = await POST(requestWith({
      clientOpId: "m-1", matchId: MATCH, inningsId: INNINGS,
      overNumber: 0, ballNumber: 1, runs: 2, batsmanId: BATS, bowlerId: BOWL,
      isLegBye: true, handoverEpoch: 3, expectedRevision: 9,
    }))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ success: true, clientOpId: "m-1", ballId: "saved-ball" })
    expect(mocks.proxy).toHaveBeenCalledWith(expect.objectContaining({
      // The backend boundary carries batter runs and a disjoint extras object.
      runs: 0, extras: { type: "legbye", runs: 2 }, clientOpId: "m-1",
      handoverEpoch: 3, expectedRevision: 9,
    }), TENANT, ACTOR)
  })

  it("adapts the legacy nested wide payload losslessly (aliases and all)", async () => {
    const response = await POST(requestWith({
      clientOpId: "m-2", matchId: MATCH, inningsId: INNINGS,
      over: 0, ball: 1, runs: 1, batsmanId: BATS, bowlerId: BOWL,
      extras: { type: "wide", runs: 1 }, handoverEpoch: 3, expectedRevision: 9,
    }))
    expect(response.status).toBe(200)
    expect(mocks.proxy).toHaveBeenCalledWith(expect.objectContaining({
      over: 0, ball: 1,
      runs: 0, extras: { type: "wide", runs: 1 },
    }), TENANT, ACTOR)
  })

  it("adapts a legacy nested wicket WITHOUT losing it — today it is silently stripped", async () => {
    const response = await POST(requestWith({
      clientOpId: "m-3", matchId: MATCH, inningsId: INNINGS,
      over: 4, ball: 2, runs: 0, batsmanId: BATS, bowlerId: BOWL,
      wicket: { type: "bowled", playerId: BATS },
    }))
    expect(response.status).toBe(200)
    expect(mocks.proxy).toHaveBeenCalledWith(expect.objectContaining({
      wicket: { type: "bowled", playerId: BATS },
    }), TENANT, ACTOR)
  })

  it("carries legacy run-out attribution: named out batter and fielder survive the boundary", async () => {
    const response = await POST(requestWith({
      clientOpId: "m-4", matchId: MATCH, inningsId: INNINGS,
      overNumber: 4, ballNumber: 2, runs: 0, batsmanId: BATS, bowlerId: BOWL,
      wicket: { type: "run_out", playerId: NON_STRIKER, fielderId: FIELDER },
    }))
    expect(response.status).toBe(200)
    expect(mocks.proxy).toHaveBeenCalledWith(expect.objectContaining({
      wicket: { type: "run_out", playerId: NON_STRIKER, fielderId: FIELDER },
    }), TENANT, ACTOR)
  })

  it("refuses rather than mangles an ambiguous legacy no-ball split", async () => {
    const response = await POST(requestWith({
      clientOpId: "m-5", matchId: MATCH, inningsId: INNINGS,
      overNumber: 0, ballNumber: 1, runs: 1, batsmanId: BATS, bowlerId: BOWL,
      extras: { type: "noball", runs: 2 },
    }))
    expect(response.status).toBe(400)
    expect(mocks.proxy).not.toHaveBeenCalled()
  })

  it("keeps refusing the smuggled 8th run from any transport", async () => {
    const response = await POST(requestWith({
      clientOpId: "m-6", matchId: MATCH, inningsId: INNINGS,
      overNumber: 0, ballNumber: 1, runs: 8, batsmanId: BATS, bowlerId: BOWL,
    }))
    expect(response.status).toBe(400)
    expect(mocks.proxy).not.toHaveBeenCalled()
  })

  it("never lets queue bookkeeping ride on a mobile submission (flat or legacy)", async () => {
    const flat = await POST(requestWith({
      clientOpId: "m-7", matchId: MATCH, inningsId: INNINGS,
      overNumber: 0, ballNumber: 1, runs: 1, batsmanId: BATS, bowlerId: BOWL,
      queueAccountId: "someone-else", queueTenantId: TENANT,
    }))
    expect(flat.status).toBe(403)
    const legacy = await POST(requestWith({
      clientOpId: "m-8", matchId: MATCH, inningsId: INNINGS,
      overNumber: 0, ballNumber: 1, runs: 1, batsmanId: BATS, bowlerId: BOWL,
      queueAccountId: "someone-else",
    }))
    expect(legacy.status).toBe(403)
    expect(mocks.proxy).not.toHaveBeenCalled()
  })

  it("returns the canonical revision-conflict shape the queue reviews", async () => {
    mocks.proxy.mockRejectedValueOnce(new ScoringRevisionConflict(12))
    const response = await POST(requestWith({
      clientOpId: "m-9", matchId: MATCH, inningsId: INNINGS,
      overNumber: 0, ballNumber: 1, runs: 1, batsmanId: BATS, bowlerId: BOWL,
      expectedRevision: 9,
    }))
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: "SCORING_REVISION_CONFLICT", currentRevision: 12 })
  })
})
