import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  approve: vi.fn(),
  reject: vi.fn(),
}))

vi.mock("@/lib/registration-management", () => ({
  approveLeagueRegistration: mocks.approve,
  rejectLeagueRegistration: mocks.reject,
}))

import { bulkReviewLeagueRegistrations, BULK_REVIEW_LIMIT } from "@/lib/registration-bulk"

const TENANT = "00000000-0000-4000-8000-000000000001"
const CLERK = "clerk_user"
const A = "00000000-0000-4000-8000-00000000000a"
const B = "00000000-0000-4000-8000-00000000000b"
const REASON = "Squad does not meet the published minimum"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("Bulk review composition (Batch 120) — compose the audited commands, never bypass them", () => {
  it("refuses to compose when the selection is malformed — before ANY database work", async () => {
    const oversized = Array.from({ length: BULK_REVIEW_LIMIT + 1 }, (_, i) =>
      `00000000-0000-4000-8000-000000000c${String(i).padStart(2, "0")}`)
    await expect(bulkReviewLeagueRegistrations(CLERK, TENANT, { operation: "approve", ids: [] })).rejects.toThrow()
    await expect(bulkReviewLeagueRegistrations(CLERK, TENANT, { operation: "approve", ids: oversized })).rejects.toThrow(/at most/)
    await expect(bulkReviewLeagueRegistrations(CLERK, TENANT, { operation: "approve", ids: [A, A] })).rejects.toThrow(/duplicate/i)
    await expect(bulkReviewLeagueRegistrations(CLERK, TENANT, { operation: "approve", ids: ["bad-uuid"] })).rejects.toThrow()
    await expect(bulkReviewLeagueRegistrations(CLERK, TENANT, { operation: "reject", ids: [A] })).rejects.toThrow(/reason/i)
    expect(mocks.approve).not.toHaveBeenCalled()
    expect(mocks.reject).not.toHaveBeenCalled()
  })

  it("approve: composes the SINGLE audited command per id, sequentially, with truthful per-item outcomes", async () => {
    mocks.approve.mockImplementation(async (_clerk: string, _tenant: string, id: string) => ({
      id, status: "approved", tournamentId: "00000000-0000-4000-8000-000000000007",
    }))
    const { results } = await bulkReviewLeagueRegistrations(CLERK, TENANT, { operation: "approve", ids: [B, A] })
    expect(mocks.approve).toHaveBeenCalledTimes(2)
    expect(mocks.approve).toHaveBeenNthCalledWith(1, CLERK, TENANT, B)
    expect(results).toEqual([
      { id: B, ok: true, status: "approved", tournamentId: "00000000-0000-4000-8000-000000000007" },
      { id: A, ok: true, status: "approved", tournamentId: "00000000-0000-4000-8000-000000000007" },
    ])
  })

  it("reject: passes the reason through to every item", async () => {
    mocks.reject.mockImplementation(async (_clerk: string, _tenant: string, id: string, reason: string) => ({
      id, status: "rejected", tournamentId: "00000000-0000-4000-8000-000000000007", rejectionReason: reason,
    }))
    await bulkReviewLeagueRegistrations(CLERK, TENANT, { operation: "reject", ids: [A, B], reason: REASON })
    expect(mocks.reject).toHaveBeenCalledWith(CLERK, TENANT, A, REASON)
    expect(mocks.reject).toHaveBeenCalledWith(CLERK, TENANT, B, REASON)
  })

  it("one item's failure is isolated and reported — the remaining items are still attempted, nothing aborts", async () => {
    mocks.approve.mockImplementation(async (_clerk: string, _tenant: string, id: string) => {
      if (id === B) throw new Error("This tournament is already at its maximum number of teams")
      return { id, status: "approved", tournamentId: "00000000-0000-4000-8000-000000000007" }
    })
    const { results } = await bulkReviewLeagueRegistrations(CLERK, TENANT, { operation: "approve", ids: [B, A] })
    expect(results).toHaveLength(2)
    expect(results[0]).toMatchObject({ id: B, ok: false, error: "This tournament is already at its maximum number of teams" })
    expect(results[1]).toMatchObject({ id: A, ok: true, status: "approved" })
  })

  it("a non-Error throw becomes an honest unknown failure, never a fabricated ok", async () => {
    mocks.reject.mockRejectedValue("string-throw")
    const { results } = await bulkReviewLeagueRegistrations(CLERK, TENANT, { operation: "reject", ids: [A], reason: REASON })
    expect(results[0]).toMatchObject({ id: A, ok: false })
    expect((results[0] as { error: string }).error).toContain("could not be reviewed")
  })
})
