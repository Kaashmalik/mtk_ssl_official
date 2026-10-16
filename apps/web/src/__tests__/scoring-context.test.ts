import { beforeEach, describe, expect, it, vi } from "vitest"
import { getMatchForScoring } from "@/app/actions/scoring"

const mocks = vi.hoisted(() => ({ auth: vi.fn(), tenant: vi.fn(), permission: vi.fn(), league: vi.fn(), match: vi.fn(), batch: vi.fn(), canScore: vi.fn() }))
vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/rbac-server", () => ({ resolveActiveTenantId: mocks.tenant, requirePermissionServer: mocks.permission }))
vi.mock("@/lib/scoring-access", () => ({ canScoreMatch: mocks.canScore }))
vi.mock("@/lib/scoring-reads", () => ({ findScoringTenant: mocks.league, findScoringMatch: mocks.match, readMatchScoringBatch: mocks.batch }))
const TENANT = "00000000-0000-4000-8000-000000000001"
const MATCH = "00000000-0000-4000-8000-000000000002"

beforeEach(() => {
  vi.resetAllMocks()
  mocks.auth.mockResolvedValue({ userId: "clerk" })
  mocks.tenant.mockResolvedValue(TENANT)
  mocks.league.mockResolvedValue({ id: TENANT })
  mocks.match.mockResolvedValue({ id: MATCH, teamAId: "a", teamBId: "b", status: "live" })
  mocks.canScore.mockResolvedValue(false)
  mocks.batch.mockResolvedValue({ teamA: [], teamB: [], allInnings: [], recentBalls: [] })
})
describe("Scoring snapshot league context for public subscriptions", () => {
  it("returns the authorized active league without treating it as a private socket grant", async () => {
    expect(await getMatchForScoring(MATCH)).toMatchObject({ tenantId: TENANT, canScore: false, match: { id: MATCH } })
    expect(mocks.match).toHaveBeenCalledWith(MATCH, TENANT)
    expect(mocks.batch).toHaveBeenCalledWith(MATCH, "a", "b", TENANT)
  })
  it("does not invent a league context when resolution fails", async () => {
    mocks.tenant.mockRejectedValue(new Error("Resolution unavailable"))
    await expect(getMatchForScoring(MATCH)).rejects.toThrow("Resolution unavailable")
    expect(mocks.match).not.toHaveBeenCalled()
  })
})
