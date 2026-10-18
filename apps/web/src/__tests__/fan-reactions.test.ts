import { beforeEach, describe, expect, it, vi } from "vitest"
import { toggleFanReaction, FAN_REACTION_TYPES } from "@/lib/fan-reactions"

const mocks = vi.hoisted(() => ({ context: vi.fn(), select: vi.fn(), insert: vi.fn(), fanBlock: vi.fn(), deletes: [] as unknown[] }))

// Passthrough for real schema tables + policy; only the db handles are mocked.
vi.mock("@mtk/database", async (importOriginal) => ({
  ...await importOriginal<typeof import("@mtk/database")>(),
  db: { select: mocks.select, insert: mocks.insert, delete: (...args: unknown[]) => {
    mocks.deletes.push(args)
    return { where: async () => {} }
  } },
}))
vi.mock("@/lib/fan-follows", () => ({ requireFanContext: mocks.context }))
vi.mock("@/lib/fan-block-records", () => ({ readActiveFanBlockExists: mocks.fanBlock }))

const FAN = { tenantId: "00000000-0000-4000-8000-0000000000a1", actorId: "00000000-0000-4000-8000-0000000000a2", clerkId: "clerk_1", role: "fan" }
const MATCH = "00000000-0000-4000-8000-0000000000b1"

/** Select call order: (1) target join, (2) existing row, (3) recent adds, (4) counts. */
function selectHarness(target: unknown[], existing: unknown[] = [], recent: unknown[] = [], counts: unknown[] = []) {
  const order = [target, existing, recent, counts]
  let call = 0
  mocks.select.mockImplementation(() => {
    const rows = order[Math.min(call++, order.length - 1)]
    return {
      from: () => ({
        innerJoin: () => ({ where: () => ({ limit: async () => rows }) }),
        where: () => ({
          limit: async () => rows,
          groupBy: async () => rows,
        }),
      }),
    }
  })
  return { call: () => call }
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.deletes.length = 0
  mocks.fanBlock.mockResolvedValue(false)
  mocks.insert.mockImplementation(() => ({
    values: () => ({ onConflictDoNothing: async () => {} }),
  }))
  mocks.context.mockResolvedValue(FAN)
})

describe("Fan reaction toggle (FAN-01 slice)", () => {
  it("refuses a league-blocked fan before any target, rate or write logic runs", async () => {
    mocks.fanBlock.mockResolvedValue(true)
    mocks.select.mockImplementation(() => {
      throw new Error("no query may run past an active block")
    })
    const result = await toggleFanReaction({ matchId: MATCH, reaction: "six" })
    expect(result).toEqual({ action: "refused", reason: "blocked" })
    expect(mocks.fanBlock).toHaveBeenCalledWith(FAN.tenantId, FAN.actorId)
    expect(mocks.insert).not.toHaveBeenCalled()
    expect(mocks.deletes).toHaveLength(0)
  })

  it("adds a reaction to a published live match and returns fresh counts", async () => {
    selectHarness([{ status: "live", tournamentStatus: "live" }], [], [{ total: 0 }])
    const result = await toggleFanReaction({ matchId: MATCH, reaction: "six" })
    expect(result).toMatchObject({ action: "added" })
    expect(result.counts).toBeDefined()
    expect(mocks.insert).toHaveBeenCalledTimes(1)
  })

  it("toggles off through DELETE - removing is never rate-limited", async () => {
    selectHarness([{ status: "live", tournamentStatus: "live" }], [{ id: "row-1" }])
    const result = await toggleFanReaction({ matchId: MATCH, reaction: "six" })
    expect(result).toMatchObject({ action: "removed" })
    expect(mocks.deletes).toHaveLength(1)
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it("refuses a flood: 20 adds inside the window and the next add is stopped", async () => {
    selectHarness([{ status: "live", tournamentStatus: "live" }], [], [{ total: 20 }])
    const result = await toggleFanReaction({ matchId: MATCH, reaction: "fire" })
    expect(result).toMatchObject({ action: "refused", reason: "rate_limited" })
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it("refuses unpublished or foreign-league targets before any write", async () => {
    selectHarness([], [], [])
    const result = await toggleFanReaction({ matchId: MATCH, reaction: "four" })
    expect(result).toMatchObject({ action: "refused", reason: "target_unpublished" })
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it("refuses a cancelled fixture even when its tournament is published (it is outside the published set)", async () => {
    selectHarness([{ status: "cancelled", tournamentStatus: "completed" }], [], [])
    const result = await toggleFanReaction({ matchId: MATCH, reaction: "clap" })
    expect(result).toMatchObject({ action: "refused", reason: "target_unpublished" })
  })

  it("validates the reaction against the fixed non-official set before any query or identity read", async () => {
    await expect(toggleFanReaction({ matchId: MATCH, reaction: "offensive-thing" })).rejects.toThrow()
    await expect(toggleFanReaction({ matchId: "not-a-uuid", reaction: "six" })).rejects.toThrow()
    expect(mocks.context).not.toHaveBeenCalled()
  })

  it("keeps reactions engagement-only: no official input name can enter the set", () => {
    expect(FAN_REACTION_TYPES.every(t => !["runs", "wickets", "points", "award"].includes(t))).toBe(true)
  })
})
