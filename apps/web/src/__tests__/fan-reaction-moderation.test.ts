import { beforeEach, describe, expect, it, vi } from "vitest"
import { removeFanReaction, readMatchReactionsForModeration } from "@/lib/fan-reaction-moderation"

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  select: vi.fn(),
  transaction: vi.fn(),
}))

vi.mock("@mtk/database", async (importOriginal) => ({
  ...await importOriginal<typeof import("@mtk/database")>(),
  db: { select: mocks.select, transaction: mocks.transaction },
}))
vi.mock("@/lib/league-reads", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/league-reads")>(),
  requireActiveLeagueContext: mocks.context,
}))

const OWNER = {
  tenantId: "00000000-0000-4000-8000-0000000000a1",
  actorId: "00000000-0000-4000-8000-0000000000a2",
  clerkId: "clerk_o",
  role: "league_owner",
}
const MATCH = "00000000-0000-4000-8000-0000000000b1"
const ROW = "00000000-0000-4000-8000-0000000000f1"
const FAN = "00000000-0000-4000-8000-0000000000a3"

beforeEach(() => {
  vi.resetAllMocks()
  mocks.context.mockResolvedValue(OWNER)
})

describe("FAN-01 owner reaction moderation", () => {
  it("reads a bounded moderation view; unknown reaction types drop out", async () => {
    const createdAt = new Date("2026-10-17T10:00:00.000Z")
    mocks.select.mockImplementation(() => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            orderBy: () => ({
              limit: async () => [
                { id: ROW, reaction: "fire", fanName: "Hamza", createdAt },
                { id: "r2", reaction: "weird-type", fanName: "X", createdAt },
              ],
            }),
          }),
        }),
      }),
    }))
    const rows = await readMatchReactionsForModeration(MATCH)
    expect(rows).toEqual([
      { id: ROW, reaction: "fire", fanName: "Hamza", createdAt: createdAt.toISOString() },
    ])
  })

  it("refuses non-uuid match ids before any gate or query", async () => {
    await expect(readMatchReactionsForModeration("not-a-uuid")).rejects.toThrow()
    await expect(removeFanReaction({ matchId: "not-a-uuid", reactionId: ROW })).rejects.toThrow()
    expect(mocks.context).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("classifies a foreign or already-removed reaction as honestly not found", async () => {
    mocks.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        select: () => ({
          from: () => ({
            where: () => ({
              // Empty: the reaction belongs to another league or is already gone.
              for: () => ({ limit: async () => [] }),
            }),
          }),
        }),
        delete: () => { throw new Error("delete must never run on a missing row") },
        insert: () => ({ values: () => ({ then: (resolve: (v: unknown[]) => void) => resolve([]) }) }),
      }
      return fn(tx)
    })
    const result = await removeFanReaction({ matchId: MATCH, reactionId: ROW })
    expect(result).toEqual({ removed: false, reason: "not_found" })
  })

  it("removes and audits under the lock when the row exists", async () => {
    let deleteCalls = 0
    let auditPayload: unknown = null
    mocks.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        select: () => ({
          from: () => ({
            where: () => ({
              for: () => ({
                limit: async () => [{ id: ROW, userId: FAN, reaction: "clap" }],
              }),
            }),
          }),
        }),
        delete: () => ({ where: () => { deleteCalls += 1; return Promise.resolve() } }),
        insert: () => ({
          values: (payload: unknown) => ({
            then: (resolve: (v: unknown[]) => void) => { auditPayload = payload; resolve([]) },
          }),
        }),
      }
      return fn(tx)
    })
    const result = await removeFanReaction({ matchId: MATCH, reactionId: ROW })
    expect(result).toEqual({ removed: true })
    expect(deleteCalls).toBe(1)
    expect(auditPayload).toMatchObject({
      method: "REACTION_REMOVE",
      path: `/dashboard/matches/${MATCH}`,
      payload: { matchId: MATCH, reactionId: ROW, reaction: "clap", fanUserId: FAN },
    })
  })

  it("runs the removal inside the writer's transaction (single commit path)", async () => {
    mocks.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        select: () => ({
          from: () => ({ where: () => ({ for: () => ({ limit: async () => [] }) }) }),
        }),
      }),
    )
    await removeFanReaction({ matchId: MATCH, reactionId: ROW })
    expect(mocks.transaction).toHaveBeenCalledTimes(1)
  })
})
