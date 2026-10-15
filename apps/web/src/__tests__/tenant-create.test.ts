import { beforeEach, describe, expect, it, vi } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import { db, tenants } from "@mtk/database"
import { createTenant, getMyOwnedTenant } from "@/app/actions/tenants"

const mocks = vi.hoisted(() => ({ auth: vi.fn() }))

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/tenant", () => ({ getTenantFromRequest: vi.fn().mockResolvedValue(null) }))
// Real schema tables and plan limits pass through; only the db handle is a mock.
vi.mock("@mtk/database", async (importOriginal) => ({
  ...await importOriginal<typeof import("@mtk/database")>(),
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    transaction: vi.fn(),
  },
}))

const dialect = new PgDialect()
const USER = "da7c0ab5-0810-482a-a92c-886a87754b20"
const CREATED = { id: "da7c0ab5-0810-482a-a92c-886a87754b2d", name: "My League", slug: "my-league" }

/** Queues the outer (non-transactional) select results: user, owner pre-check, slug pre-check. */
function queueOuterSelects(rows: unknown[][]) {
  const select = vi.fn()
  rows.forEach((r) => select.mockReturnValueOnce({
    from: () => ({ where: () => ({ limit: async () => r }) }),
  }))
  ;(db as any).select = select
}

/** Builds the transaction mock: row lock, in-transaction cap re-check and the write chain. */
function txMock({ owned = null as unknown, insertError = null as unknown } = {}) {
  const execute = vi.fn().mockResolvedValue(undefined)
  const recheckConds: unknown[] = []
  const txSelect = vi.fn(() => ({
    from: () => ({
      where: (cond: unknown) => {
        recheckConds.push(cond)
        return { limit: async () => (owned ? [owned] : []) }
      },
    }),
  }))
  const returning = vi.fn(async () => {
    if (insertError) throw insertError
    return [CREATED]
  })
  const insert = vi.fn(() => ({
    values: () => ({ returning, onConflictDoNothing: async () => {} }),
  }))
  const update = vi.fn(() => ({ set: () => ({ where: async () => {} }) }))
  ;(db as any).transaction = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
    cb({ execute, select: txSelect, insert, update }))
  return { execute, txSelect, recheckConds, insert, returning }
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.auth.mockResolvedValue({ userId: "clerk-1" })
})

describe("createTenant serializes the one-league cap", () => {
  it("locks the actor row and re-checks ownership inside the transaction before writing", async () => {
    queueOuterSelects([[{ id: USER, tenantIds: [], isActive: true }], [], []])
    const tx = txMock()

    const response = await createTenant({ name: "My League", slug: "my-league" })

    expect(response.success).toBe(true)
    expect(response.tenant).toEqual(CREATED)
    // The cap is enforced under a row lock, not only by the racy pre-check.
    expect(tx.execute).toHaveBeenCalledTimes(1)
    const locked = dialect.sqlToQuery(tx.execute.mock.calls[0][0])
    expect(locked.sql).toContain("FOR UPDATE")
    expect(locked.params).toEqual([USER])
    const recheck = dialect.sqlToQuery(tx.recheckConds[0] as never)
    expect(recheck.params).toEqual([USER])
    expect(tx.insert).toHaveBeenCalledWith(tenants)
  })

  it("refuses to create a second league when the in-transaction cap re-check finds ownership", async () => {
    queueOuterSelects([[{ id: USER, tenantIds: [], isActive: true }], [], []])
    const tx = txMock({ owned: { id: "already-owned" } })

    await expect(createTenant({ name: "My League", slug: "my-league" }))
      .rejects.toThrow("You already have a league. Contact support to create another.")
    expect(tx.execute).toHaveBeenCalledTimes(1)
    expect(tx.insert).not.toHaveBeenCalled()
  })

  it("maps a slug unique-violation from the row-level index to the friendly error", async () => {
    queueOuterSelects([[{ id: USER, tenantIds: [], isActive: true }], [], []])
    const tx = txMock({ insertError: Object.assign(new Error("duplicate key"), { code: "23505" }) })

    await expect(createTenant({ name: "My League", slug: "my-league" }))
      .rejects.toThrow("This league URL is already taken. Please choose another.")
    // The locked write was attempted exactly once (the raciness case).
    expect(tx.returning).toHaveBeenCalledTimes(1)
  })

  it("rethrows infrastructure failures unchanged instead of masquerading as duplicates", async () => {
    queueOuterSelects([[{ id: USER, tenantIds: [], isActive: true }], [], []])
    txMock({ insertError: new Error("connection reset") })

    await expect(createTenant({ name: "My League", slug: "my-league" })).rejects.toThrow("connection reset")
  })

  it("stops unauthenticated callers before any read", async () => {
    mocks.auth.mockResolvedValue({})
    await expect(createTenant({ name: "My League", slug: "my-league" })).rejects.toThrow("Unauthorized")
  })
})

describe("getMyOwnedTenant gates on ownership, not membership", () => {
  /** Two reads: account lookup by Clerk id, then the owned-league lookup. */
  function queueOwnershipReads(account: unknown[], owned: unknown[]) {
    const select = vi.fn()
      .mockReturnValueOnce({ from: () => ({ where: () => ({ limit: async () => account }) }) })
      .mockReturnValueOnce({ from: () => ({ where: () => ({ limit: async () => owned }) }) })
    ;(db as any).select = select
  }

  it("returns the owned league for an owner", async () => {
    queueOwnershipReads([{ id: USER, isActive: true }], [{ id: "t1", name: "Mine", slug: "mine" }])
    expect(await getMyOwnedTenant()).toEqual({ id: "t1", name: "Mine", slug: "mine" })
  })

  it("returns null for a member of another league who owns none (they may create one)", async () => {
    queueOwnershipReads([{ id: USER, isActive: true }], [])
    expect(await getMyOwnedTenant()).toBeNull()
  })

  it("returns null for an inactive account without reading leases", async () => {
    queueOwnershipReads([{ id: USER, isActive: false }], [])
    expect(await getMyOwnedTenant()).toBeNull()
  })

  it("returns null without any read for an unauthenticated caller", async () => {
    mocks.auth.mockResolvedValue({})
    expect(await getMyOwnedTenant()).toBeNull()
    expect(db.select).not.toHaveBeenCalled()
  })
})
