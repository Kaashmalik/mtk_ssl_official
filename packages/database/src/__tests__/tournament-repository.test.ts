import { beforeEach, describe, expect, it, vi } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import type { SQL } from "drizzle-orm"

const mocks = vi.hoisted(() => {
  const lockedRead = vi.fn()
  const returning = vi.fn()
  const read = { from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(), for: lockedRead }
  const write = { set: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), returning }
  const tx = { select: vi.fn(() => read), update: vi.fn(() => write) }
  return { read, write, tx, lockedRead, returning,
    transaction: vi.fn((callback) => callback(tx)) }
})
vi.mock("../client", () => ({ db: { transaction: mocks.transaction } }))
import { TournamentRepo } from "../repositories/tournament.repo"
import { withTenantContext } from "../tenant-context"

const TENANT = "a53bc9d0-e872-440b-b0af-db4a8918a25f"
const ID = "61d9249f-8389-4627-9cac-7e2ff4c48174"
const repo = new TournamentRepo()

beforeEach(() => {
  vi.clearAllMocks()
  mocks.lockedRead.mockResolvedValue([{ id: ID, tenantId: TENANT, name: "Original" }])
  mocks.returning.mockResolvedValue([{ id: ID, tenantId: TENANT, name: "Updated" }])
})

describe("Locked tournament settings update", () => {
  it("locks before validation and filters both reads and writes by tenant and ID", async () => {
    const prepare = vi.fn((existing) => {
      expect(existing.name).toBe("Original")
      expect(mocks.lockedRead).toHaveBeenCalledWith("update")
      expect(mocks.tx.update).not.toHaveBeenCalled()
      return { name: "Updated" }
    })
    const result = await withTenantContext({ userId: "user-1", tenantId: TENANT }, () => repo.updateWithLock(ID, prepare))
    expect(result?.name).toBe("Updated")
    expect(mocks.transaction).toHaveBeenCalledOnce()
    expect(prepare).toHaveBeenCalledOnce()
    expect(mocks.write.set).toHaveBeenCalledWith({ name: "Updated" })
    for (const where of [mocks.read.where.mock.calls[0][0], mocks.write.where.mock.calls[0][0]]) {
      const query = new PgDialect().sqlToQuery(where as SQL)
      expect(query.sql).toContain('"tournaments"."tenant_id"')
      expect(query.sql).toContain('"tournaments"."id"')
      expect(query.params).toEqual([TENANT, ID])
    }
  })

  it("does not validate or write if the scoped row is missing", async () => {
    mocks.lockedRead.mockResolvedValue([])
    const prepare = vi.fn()
    expect(await withTenantContext({ userId: "user-1", tenantId: TENANT }, () => repo.updateWithLock(ID, prepare))).toBeNull()
    expect(prepare).not.toHaveBeenCalled()
    expect(mocks.tx.update).not.toHaveBeenCalled()
  })

  it("stops the transaction before writing if dependent validation fails", async () => {
    await expect(withTenantContext({ userId: "user-1", tenantId: TENANT }, () => repo.updateWithLock(ID, () => {
      throw new Error("Invalid date range")
    }))).rejects.toThrow("Invalid date range")
    expect(mocks.tx.update).not.toHaveBeenCalled()
  })

  it("fails closed without a tenant context", async () => {
    await expect(repo.updateWithLock(ID, () => ({ name: "Updated" }))).rejects.toThrow("No tenant context")
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
})
