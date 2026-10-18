import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  readActiveFanBlockExists, blockFanInteraction, liftFanBlock, readActiveFanBlocks,
} from "@/lib/fan-block-records"

const mocks = vi.hoisted(() => ({
  leagueContext: vi.fn(),
  select: vi.fn(),
  insert: vi.fn(),
  transaction: vi.fn(),
}))

vi.mock("@mtk/database", async (importOriginal) => ({
  ...await importOriginal<typeof import("@mtk/database")>(),
  db: { select: mocks.select, insert: mocks.insert, transaction: mocks.transaction },
}))
vi.mock("@/lib/league-reads", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/league-reads")>(),
  requireActiveLeagueContext: mocks.leagueContext,
}))

const LEAGUE = "00000000-0000-4000-8000-0000000000a1"
const OWNER = {
  tenantId: LEAGUE,
  actorId: "00000000-0000-4000-8000-0000000000a2",
  clerkId: "clerk_o",
  role: "league_owner" as const,
}
const FAN = "00000000-0000-4000-8000-0000000000a3"
const BLOCK = "00000000-0000-4000-8000-0000000000d1"

beforeEach(() => {
  vi.resetAllMocks()
  mocks.leagueContext.mockResolvedValue(OWNER)
})

describe("FAN-01 league-scoped fan blocks (owner write)", () => {
  it("reports whether an ACTIVE block exists for the enforcement writers", async () => {
    mocks.select.mockImplementation(() => ({
      from: () => ({
        where: () => ({ limit: async () => [{ id: BLOCK }] }),
      }),
    }))
    expect(await readActiveFanBlockExists(LEAGUE, FAN)).toBe(true)
    mocks.select.mockImplementation(() => ({
      from: () => ({
        where: () => ({ limit: async () => [] }),
      }),
    }))
    expect(await readActiveFanBlockExists(LEAGUE, FAN)).toBe(false)
  })

  it("validates shape before any gate or query", async () => {
    await expect(blockFanInteraction({ fanUserId: "nope", reason: "other" })).rejects.toThrow()
    await expect(blockFanInteraction({ fanUserId: FAN, reason: "just because" })).rejects.toThrow()
    await expect(liftFanBlock({ fanUserId: "nope" })).rejects.toThrow()
    expect(mocks.leagueContext).not.toHaveBeenCalled()
    expect(mocks.insert).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("blocks with provenance and audits it (league scope in the payload)", async () => {
    const payloads: unknown[] = []
    let insertCall = 0
    mocks.insert.mockImplementation((_table: unknown) => {
      insertCall += 1
      if (insertCall === 1) {
        return {
          values: (payload: unknown) => {
            payloads.push(payload)
            return {
              onConflictDoNothing: () => ({
                returning: async () => [{ id: BLOCK }],
              }),
            }
          },
        }
      }
      return {
        values: (payload: unknown) => ({
          then: (resolve: (v: unknown[]) => void) => {
            payloads.push(payload)
            resolve([])
          },
        }),
      }
    })
    const result = await blockFanInteraction({ fanUserId: FAN, reason: "report_abuse" })
    expect(result).toEqual({ action: "blocked" })
    expect(payloads[0]).toMatchObject({
      tenantId: LEAGUE, blockedUserId: FAN, blockedBy: OWNER.actorId, reason: "report_abuse",
    })
    expect(payloads[1]).toMatchObject({
      method: "FAN_BLOCK",
      payload: { blockedUserId: FAN, reason: "report_abuse", scope: "league" },
    })
  })

  it("degrades a re-block while active to an honest no-op without an audit", async () => {
    const payloads: unknown[] = []
    let insertCall = 0
    mocks.insert.mockImplementation((_table: unknown) => {
      insertCall += 1
      if (insertCall === 1) {
        return {
          values: (payload: unknown) => {
            payloads.push(payload)
            return {
              onConflictDoNothing: () => ({
                // Partial unique absorbed the re-block.
                returning: async () => [],
              }),
            }
          },
        }
      }
      return {
        values: (payload: unknown) => ({
          then: (resolve: (v: unknown[]) => void) => {
            payloads.push(payload)
            resolve([])
          },
        }),
      }
    })
    const result = await blockFanInteraction({ fanUserId: FAN, reason: "other" })
    expect(result).toEqual({ action: "already_blocked" })
    expect(payloads).toHaveLength(1) // the absorbed insert, never the audit
  })

  it("lifts the active block with reviewer provenance and audits it", async () => {
    let updatePayload: unknown = null
    let auditPayload: unknown = null
    mocks.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        select: () => ({
          from: () => ({
            where: () => ({
              for: () => ({ limit: async () => [{ id: BLOCK, status: "active" }] }),
            }),
          }),
        }),
        update: () => ({
          set: (payload: unknown) => {
            updatePayload = payload
            return { where: () => Promise.resolve() }
          },
        }),
        insert: () => ({
          values: (payload: unknown) => ({
            then: (resolve: (v: unknown[]) => void) => {
              auditPayload = payload
              resolve([])
            },
          }),
        }),
      }
      return fn(tx)
    })
    const result = await liftFanBlock({ fanUserId: FAN })
    expect(result).toEqual({ lifted: true })
    expect(updatePayload).toMatchObject({ status: "lifted", liftedBy: OWNER.actorId })
    expect((updatePayload as { liftedAt: Date }).liftedAt).toBeInstanceOf(Date)
    expect(auditPayload).toMatchObject({
      method: "FAN_BLOCK_LIFT",
      payload: { blockedUserId: FAN, blockId: BLOCK },
    })
  })

  it("reads a foreign-league block as honestly not found", async () => {
    mocks.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        select: () => ({
          from: () => ({
            where: () => ({
              for: () => ({ limit: async () => [] }),
            }),
          }),
        }),
        update: () => {
          throw new Error("update must never run on a missing row")
        },
      }),
    )
    const result = await liftFanBlock({ fanUserId: FAN })
    expect(result).toEqual({ lifted: false, reason: "not_found" })
  })

  it("reads the blocked list as an explicit projection only", async () => {
    const createdAt = new Date("2026-10-18T11:00:00.000Z")
    mocks.select.mockImplementation(() => ({
      from: () => ({
        innerJoin: () => ({
          where: () => ({
            orderBy: () => ({
              limit: async () => [
                { fanUserId: FAN, fanName: "Hamza", reason: "report_abuse", createdAt },
              ],
            }),
          }),
        }),
      }),
    }))
    const rows = await readActiveFanBlocks()
    expect(rows).toEqual([
      { fanUserId: FAN, fanName: "Hamza", reason: "report_abuse", createdAt: createdAt.toISOString() },
    ])
  })
})
