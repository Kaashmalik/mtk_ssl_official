import { beforeEach, describe, expect, it, vi } from "vitest"
import { db } from "@mtk/database"
import { setHubListing, readMyHubListing } from "@/lib/hub-listing-settings"

const mocks = vi.hoisted(() => ({ auth: vi.fn() }))
vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }))
// Real schema tables and the real shared listing policy pass through; only the db handle is a mock.
vi.mock("@mtk/database", async (importOriginal) => ({
  ...await importOriginal<typeof import("@mtk/database")>(),
  db: {
    select: vi.fn(),
    transaction: vi.fn(),
  },
}))

const USER = "00000000-0000-4000-8000-0000000000a1"
const TENANT = "00000000-0000-4000-8000-0000000000b2"
const LISTED_AT = new Date("2026-10-17T00:00:00Z")

/** Queues the outer (non-transactional, read-path) selects in order. */
function queueOuterSelects(rows: unknown[][]) {
  const select = vi.fn()
  for (let i = 0; i < rows.length; i++) {
    select.mockImplementationOnce(() => ({
      from: () => ({ where: () => ({ limit: async () => rows[i] }) }),
    }))
  }
  ;(db as any).select = select
}

/** Builds the transaction mock: tenant lock, owned-tenant re-read, update, tenant-scoped audit row. */
function txMock({ current = { id: TENANT, isActive: true, hubListingStatus: "unlisted", hubListedAt: null } as unknown,
  updated = { hubListingStatus: "listed", hubListedAt: LISTED_AT } as unknown } = {}) {
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
  return { execute, update, set, insert, values, returning }
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.auth.mockResolvedValue({ userId: "clerk_1" })
})

describe("Owner hub listing decision (PUB-02)", () => {
  it("lists the league with the tenant row locked and a tenant-scoped audited decision", async () => {
    queueOuterSelects([[{ id: USER, isActive: true }]])
    const tx = txMock()

    const result = await setHubListing(true)

    expect(result).toEqual({ listed: "listed", listedAt: LISTED_AT, changed: true })
    // The lock precedes the re-read and the write.
    expect(tx.execute).toHaveBeenCalledTimes(1)
    expect(tx.set).toHaveBeenCalledWith(expect.objectContaining({
      hubListingStatus: "listed",
      hubListedAt: expect.any(Date),
      updatedAt: expect.any(Date),
    }))
    expect(tx.insert).toHaveBeenCalledTimes(1)
    expect(tx.values).toHaveBeenCalledWith(expect.objectContaining({
      method: "HUB_LISTING",
      tenantId: TENANT,
      actorId: USER,
      actorRole: "owner",
      payload: expect.objectContaining({
        enable: true,
        before: { hubListingStatus: "unlisted", hubListedAt: null },
      }),
    }))
  })

  it("delisting clears the provenance timestamp instead of leaving a stale grant", async () => {
    queueOuterSelects([[{ id: USER, isActive: true }]])
    const tx = txMock({
      current: { id: TENANT, isActive: true, hubListingStatus: "listed", hubListedAt: LISTED_AT },
      updated: { hubListingStatus: "unlisted", hubListedAt: null },
    })

    const result = await setHubListing(false)

    expect(result.listed).toBe("unlisted")
    expect(result.listedAt).toBeNull()
    expect(tx.set).toHaveBeenCalledWith(expect.objectContaining({ hubListingStatus: "unlisted", hubListedAt: null }))
    expect(tx.values).toHaveBeenCalledWith(expect.objectContaining({
      method: "HUB_LISTING",
      payload: expect.objectContaining({ enable: false }),
    }))
  })

  it("an unchanged decision is a no-op without a write", async () => {
    queueOuterSelects([[{ id: USER, isActive: true }]])
    const tx = txMock({
      current: { id: TENANT, isActive: true, hubListingStatus: "listed", hubListedAt: LISTED_AT },
    })

    const result = await setHubListing(true)

    expect(result).toEqual({ listed: "listed", listedAt: LISTED_AT, changed: false })
    expect(tx.update).not.toHaveBeenCalled()
    expect(tx.insert).not.toHaveBeenCalled()
    expect(tx.values).not.toHaveBeenCalled()
  })

  it("refuses an account with no active league before any write", async () => {
    queueOuterSelects([[{ id: USER, isActive: true }]])
    const tx = txMock({ current: [] })
    tx.update.mockImplementation(() => { throw new Error("must not write") })

    await expect(setHubListing(true)).rejects.toThrow("no active league is owned by this account")
    expect(tx.update).not.toHaveBeenCalled()
  })

  it("refuses an inactive account before any lock or write", async () => {
    queueOuterSelects([[{ id: USER, isActive: false }]])
    const tx = txMock()
    tx.update.mockImplementation(() => { throw new Error("must not write") })

    await expect(setHubListing(true)).rejects.toThrow("Forbidden: hub listing account unavailable")
    expect((db as any).transaction).not.toHaveBeenCalled()
  })

  it("stops an unauthenticated caller before any read", async () => {
    mocks.auth.mockResolvedValue({ userId: null })
    const select = vi.fn()
    ;(db as any).select = select

    await expect(setHubListing(true)).rejects.toThrow("Unauthorized")
    expect(select).not.toHaveBeenCalled()
  })

  it("fails closed when the owner predicate returns no updated row (ownership race)", async () => {
    queueOuterSelects([[{ id: USER, isActive: true }]])
    const tx = txMock({ updated: [] })
    ;(tx.returning as any).mockResolvedValue([])

    await expect(setHubListing(true)).rejects.toThrow("could not be recorded")
    expect(tx.values).not.toHaveBeenCalled()
  })
})

describe("Owner hub listing read", () => {
  it("returns the owner's current listing state with the policy verdict", async () => {
    queueOuterSelects([
      [{ id: USER, isActive: true }],
      [{ id: TENANT, isActive: true, hubListingStatus: "listed", hubListedAt: LISTED_AT }],
    ])

    expect(await readMyHubListing()).toEqual({ isOwner: true, listed: "listed", listedAt: LISTED_AT, eligible: true })
  })

  it("hides the control entirely from accounts that own no active league", async () => {
    queueOuterSelects([[{ id: USER, isActive: true }], []])

    expect(await readMyHubListing()).toEqual({ isOwner: false, listed: "unlisted", listedAt: null, eligible: false })
  })

  it("verdicts an inconsistent listed-without-timestamp row as not eligible", async () => {
    queueOuterSelects([
      [{ id: USER, isActive: true }],
      [{ id: TENANT, isActive: true, hubListingStatus: "listed", hubListedAt: null }],
    ])

    const result = await readMyHubListing()
    expect(result.eligible).toBe(false)
  })
})
