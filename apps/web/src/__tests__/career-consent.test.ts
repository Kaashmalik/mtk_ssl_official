import { beforeEach, describe, expect, it, vi } from "vitest"
import { db } from "@mtk/database"
import { setPublicCareerConsent } from "@/lib/career-records"

const mocks = vi.hoisted(() => ({ auth: vi.fn() }))

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }))
// Real schema tables and the real career-records policy pass through; only the db handle is a mock.
vi.mock("@mtk/database", async (importOriginal) => ({
  ...await importOriginal<typeof import("@mtk/database")>(),
  db: {
    select: vi.fn(),
    transaction: vi.fn(),
  },
}))

const USER = "da7c0ab5-0810-482a-a92c-886a87754b20"
const CONSENTED_AT = new Date("2026-10-17T00:00:00Z")

/** Queues the outer (non-transactional) account lookup by clerk id. */
function outerSelect(rows: unknown[]) {
  ;(db as any).select = vi.fn(() => ({
    from: () => ({ where: () => ({ limit: async () => rows }) }),
  }))
}

/** Builds the transaction mock: account lock, consent re-read, update, user-level audit row. */
function txMock({ current = { publicCareerConsentAt: null } as unknown, updated = { publicCareerConsentAt: CONSENTED_AT } as unknown } = {}) {
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

describe("Public career consent (PUB-03)", () => {
  it("grants consent with the account locked, then writes a user-level audit row", async () => {
    outerSelect([{ id: USER, isActive: true }])
    const tx = txMock()

    const result = await setPublicCareerConsent(true)

    expect(result.granted).toBe(true)
    expect(result.consentedAt).toBe(CONSENTED_AT)
    // PUB-06 cache invalidation: the action needs the internal user id to
    // revalidate the public career hub for exactly this account.
    expect(result.userId).toBe(USER)
    // The lock precedes the re-read and the write.
    expect(tx.execute).toHaveBeenCalledTimes(1)
    expect(tx.update).toHaveBeenCalledTimes(1)
    expect(tx.set).toHaveBeenCalledWith(expect.objectContaining({
      publicCareerConsentAt: expect.any(Date),
      updatedAt: expect.any(Date),
    }))
    expect(tx.insert).toHaveBeenCalledTimes(1)
    expect(tx.values).toHaveBeenCalledWith(expect.objectContaining({
      method: "PUBLIC_CAREER_CONSENT",
      tenantId: null,
      actorId: USER,
    }))
  })

  it("revocation clears the timestamp instead of leaving a stale grant", async () => {
    outerSelect([{ id: USER, isActive: true }])
    const tx = txMock({ updated: { publicCareerConsentAt: null } })

    const result = await setPublicCareerConsent(false)

    expect(result.granted).toBe(false)
    expect(result.consentedAt).toBeNull()
    expect(tx.set).toHaveBeenCalledWith(expect.objectContaining({ publicCareerConsentAt: null }))
  })

  it("refuses an inactive account before any lock or write", async () => {
    outerSelect([{ id: USER, isActive: false }])
    const tx = txMock()
    tx.update.mockImplementation(() => { throw new Error("must not write") })

    await expect(setPublicCareerConsent(true)).rejects.toThrow("Forbidden: consent account unavailable")
    expect((db as any).transaction).not.toHaveBeenCalled()
  })

  it("stops an unauthenticated caller before any read", async () => {
    mocks.auth.mockResolvedValue({ userId: null })
    const select = vi.fn()
    ;(db as any).select = select

    await expect(setPublicCareerConsent(true)).rejects.toThrow("Unauthorized")
    expect(select).not.toHaveBeenCalled()
  })
})
