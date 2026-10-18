import { beforeEach, describe, expect, it, vi } from "vitest"
import { db } from "@mtk/database"
import { readMyDisplayName, setMyDisplayName } from "@/lib/profile-records"

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

const USER = "ea91c7d2-0810-482a-a92c-886a87754b42"

/** Queues the outer (non-transactional) account lookup by clerk id. */
function outerSelect(rows: unknown[]) {
  ;(db as any).select = vi.fn()
    .mockImplementationOnce(() => ({
      from: () => ({ where: () => ({ limit: async () => rows }) }),
    }))
}

/** Builds the transaction mock: account lock, name re-read, update, audit row. */
function txMock({ current = { displayName: null } as unknown, updated = { displayName: "Ayesha Khan" } as unknown } = {}) {
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

describe("Display-name profile journey (REG-05, Batch 142)", () => {
  it("saves a normalized name with the account locked, then writes a user-level audit row", async () => {
    outerSelect([{ id: USER, isActive: true }])
    const tx = txMock()
    const result = await setMyDisplayName({ displayName: "  Ayesha   Khan " })
    expect(result).toEqual({ userId: USER, displayName: "Ayesha Khan", changed: true })
    expect(tx.execute).toHaveBeenCalled() // FOR UPDATE lock
    expect(tx.set).toHaveBeenCalledWith({ displayName: "Ayesha Khan", updatedAt: expect.any(Date) })
    expect(tx.insert).toHaveBeenCalled()
    const audit = (tx.values as any).mock.calls[0][0]
    expect(audit).toMatchObject({ actorId: USER, tenantId: null, method: "DISPLAY_NAME" })
    expect(audit.payload).toEqual({
      before: { displayName: null },
      after: { displayName: "Ayesha Khan" },
    })
  })

  it("an identical value is a pure read: no update, no second audit row", async () => {
    outerSelect([{ id: USER, isActive: true }])
    const tx = txMock({ current: { displayName: "Ayesha Khan" } })
    const result = await setMyDisplayName({ displayName: "Ayesha Khan" })
    expect(result).toEqual({ userId: USER, displayName: "Ayesha Khan", changed: false })
    expect(tx.update).not.toHaveBeenCalled()
    expect(tx.insert).not.toHaveBeenCalled()
    expect(tx.execute).toHaveBeenCalled()
  })

  it("an empty value REMOVES the name (null stored, before/after audited)", async () => {
    outerSelect([{ id: USER, isActive: true }])
    const tx = txMock({ current: { displayName: "Ayesha Khan" }, updated: { displayName: null } })
    const result = await setMyDisplayName({ displayName: "   " })
    expect(result).toEqual({ userId: USER, displayName: null, changed: true })
    expect(tx.set).toHaveBeenCalledWith({ displayName: null, updatedAt: expect.any(Date) })
  })

  it("refuses an over-length name before any transaction begins", async () => {
    const transactionSpy = vi.fn()
    ;(db as any).transaction = transactionSpy
    await expect(setMyDisplayName({ displayName: "A".repeat(61) })).rejects.toThrow(/at most 60/)
    expect(transactionSpy).not.toHaveBeenCalled()
  })

  it("refuses an unavailable account fail-closed", async () => {
    outerSelect([])
    await expect(setMyDisplayName({ displayName: "Ayesha" })).rejects.toThrow("Account unavailable")
  })

  it("the self-read returns the name for an active account and null otherwise", async () => {
    outerSelect([{ id: USER, isActive: true }])
    ;(db as any).select = vi.fn()
      .mockImplementationOnce(() => ({
        from: () => ({ where: () => ({ limit: async () => [{ id: USER, isActive: true }] }) }),
      }))
      .mockImplementationOnce(() => ({
        from: () => ({ where: () => ({ limit: async () => [{ displayName: "Ayesha Khan" }] }) }),
      }))
    expect(await readMyDisplayName()).toBe("Ayesha Khan")

    ;(db as any).select = vi.fn(() => ({
      from: () => ({ where: () => ({ limit: async () => [] }) }),
    }))
    expect(await readMyDisplayName()).toBeNull()
  })
})
