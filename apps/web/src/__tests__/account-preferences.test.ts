import { beforeEach, describe, expect, it, vi } from "vitest"
import { db } from "@mtk/database"
import { readMyDisplayTimeZone, setMyDisplayTimeZone } from "@/lib/account-preferences"

const mocks = vi.hoisted(() => ({ auth: vi.fn() }))

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }))
// Real schema tables and policy pass through; only the db handle is a mock.
vi.mock("@mtk/database", async (importOriginal) => ({
  ...await importOriginal<typeof import("@mtk/database")>(),
  db: {
    select: vi.fn(),
    transaction: vi.fn(),
  },
}))

const USER = "da7c0ab5-0810-482a-a92c-886a87754b21"

/** Queues the outer (non-transactional) account lookup by clerk id. */
function outerSelect(rows: unknown[]) {
  ;(db as any).select = vi.fn(() => ({
    from: () => ({ where: () => ({ limit: async () => rows }) }),
  }))
}

/** Builds the transaction mock: account lock, timezone re-read, update, audit row. */
function txMock({ current = { timeZone: null } as unknown, updated = { timeZone: "Asia/Karachi" } as unknown } = {}) {
  const execute = vi.fn().mockResolvedValue(undefined)
  const txSelect = vi.fn(() => ({
    from: () => ({ where: () => ({ limit: async () => [current] }) }),
  }))
  const returning = vi.fn(async () => [updated])
  const set = vi.fn(() => ({ where: () => ({ returning }) }))
  const update = vi.fn(() => ({ set }))
  const values = vi.fn(async () => {})
  const insert = vi.fn(() => ({ values }))
  ;(db as any).transaction = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
    cb({ execute, select: txSelect, update, insert }))
  return { execute, update, set, insert, values }
}

beforeEach(() => {
  mocks.auth.mockReset()
  mocks.auth.mockResolvedValue({ userId: "clerk_1" })
})

describe("Display timezone preference (UX-03)", () => {
  it("saves a valid zone with the account locked, then writes a user-level audit row", async () => {
    outerSelect([{ id: USER, isActive: true }])
    const tx = txMock()

    const result = await setMyDisplayTimeZone({ timeZone: "Asia/Karachi" })

    expect(result.timeZone).toBe("Asia/Karachi")
    // The lock precedes the re-read and the write.
    expect(tx.execute).toHaveBeenCalledTimes(1)
    expect(tx.update).toHaveBeenCalledTimes(1)
    expect(tx.set).toHaveBeenCalledWith(expect.objectContaining({
      timeZone: "Asia/Karachi",
      updatedAt: expect.any(Date),
    }))
    expect(tx.insert).toHaveBeenCalledTimes(1)
    expect(tx.values).toHaveBeenCalledWith(expect.objectContaining({
      method: "DISPLAY_TIMEZONE",
      tenantId: null,
      actorId: USER,
      path: "/dashboard/account",
    }))
  })

  it("null clears the preference instead of leaving a stale zone", async () => {
    outerSelect([{ id: USER, isActive: true }])
    const tx = txMock({ updated: { timeZone: null } })

    const result = await setMyDisplayTimeZone({ timeZone: null })

    expect(result.timeZone).toBeNull()
    expect(tx.set).toHaveBeenCalledWith(expect.objectContaining({ timeZone: null }))
    expect(tx.values).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({ timeZone: null }),
    }))
  })

  it("rejects an unknown zone string before any db work", async () => {
    outerSelect([{ id: USER, isActive: true }])
    const select = vi.fn()
    ;(db as any).select = select
    ;(db as any).transaction = vi.fn(() => { throw new Error("must not transact") })

    await expect(setMyDisplayTimeZone({ timeZone: "Mars/Olympus" })).rejects.toThrow("Unknown time zone")
    expect(select).not.toHaveBeenCalled()
    expect((db as any).transaction).not.toHaveBeenCalled()
  })

  it("refuses an inactive account before any lock or write", async () => {
    outerSelect([{ id: USER, isActive: false }])
    const tx = txMock()
    tx.update.mockImplementation(() => { throw new Error("must not write") })

    // The availability message mirrors the consent writer's boundary honesty.
    await expect(setMyDisplayTimeZone({ timeZone: "UTC" })).rejects.toThrow("Account unavailable")
    expect((db as any).transaction).not.toHaveBeenCalled()
  })

  it("stops an unauthenticated caller before any read", async () => {
    mocks.auth.mockResolvedValue({ userId: null })
    const select = vi.fn()
    ;(db as any).select = select

    await expect(setMyDisplayTimeZone({ timeZone: "UTC" })).rejects.toThrow("Unauthorized")
    expect(select).not.toHaveBeenCalled()
  })

  it("reads the current preference, normalising a stored empty string to null", async () => {
    outerSelect([{ timeZone: "Asia/Karachi" }])
    await expect(readMyDisplayTimeZone()).resolves.toEqual({ timeZone: "Asia/Karachi" })

    outerSelect([{ timeZone: null }])
    await expect(readMyDisplayTimeZone()).resolves.toEqual({ timeZone: null })
  })
})
