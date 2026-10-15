import { beforeEach, describe, expect, it, vi } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import { archiveVenue, createVenue, updateVenue } from "@/app/actions/venues"

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), resolveTenant: vi.fn(), authorize: vi.fn(), revalidate: vi.fn(),
  transaction: vi.fn(), execute: vi.fn(),
  txUser: vi.fn(), txLeague: vi.fn(), txMember: vi.fn(), txVenue: vi.fn(),
  insert: vi.fn(), values: vi.fn(), insertReturning: vi.fn(),
  update: vi.fn(), set: vi.fn(), where: vi.fn(), updateReturning: vi.fn(),
}))

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }))
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }))
vi.mock("@/lib/rbac-server", () => ({
  resolveActiveTenantId: mocks.resolveTenant,
  requirePermissionServer: mocks.authorize,
}))
vi.mock("@mtk/database", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@mtk/database")>()
  return { ...actual, db: { transaction: mocks.transaction } }
})

const CLERK_ID = "user_clerk_identity"
const USER_ID = "7daa50a3-aace-4bd7-aa82-e5a0c248c656"
const TENANT = "a53bc9d0-e872-440b-b0af-db4a8918a25f"
const OTHER_TENANT = "b63bc9d0-e872-440b-b0af-db4a8918a25f"
const VENUE_ID = "61d9249f-8389-4627-9cac-7e2ff4c48174"
const dialect = new PgDialect()
const input = { name: "Gaddafi Stadium", city: "Lahore" }

describe("Venue action tenant and authority boundaries", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.auth.mockResolvedValue({ userId: CLERK_ID })
    mocks.resolveTenant.mockResolvedValue(TENANT)
    mocks.authorize.mockResolvedValue(undefined)
    mocks.execute.mockResolvedValue([])
    mocks.txUser.mockResolvedValue({ id: USER_ID, clerkId: CLERK_ID, isActive: true })
    mocks.txLeague.mockResolvedValue({ id: TENANT, isActive: true })
    mocks.txMember.mockResolvedValue({ userId: USER_ID, tenantId: TENANT, role: "league_owner", status: "active" })
    mocks.txVenue.mockResolvedValue(undefined)
    mocks.insert.mockReturnValue({ values: mocks.values })
    mocks.values.mockReturnValue({ returning: mocks.insertReturning })
    mocks.insertReturning.mockResolvedValue([{ id: VENUE_ID, name: input.name, tenantId: TENANT }])
    mocks.update.mockReturnValue({ set: mocks.set })
    mocks.set.mockReturnValue({ where: mocks.where })
    mocks.where.mockReturnValue({ returning: mocks.updateReturning })
    mocks.updateReturning.mockResolvedValue([{ id: VENUE_ID, tenantId: TENANT, isActive: false }])
    mocks.transaction.mockImplementation(async (fn: any) => fn({
      execute: mocks.execute, insert: mocks.insert, update: mocks.update,
      query: { users: { findFirst: mocks.txUser }, tenants: { findFirst: mocks.txLeague },
        userTenantRoles: { findFirst: mocks.txMember }, venues: { findFirst: mocks.txVenue } },
    }))
  })

  it("creates in the exact active league under the owner lock with an audit", async () => {
    const result = await createVenue(input)

    expect(mocks.resolveTenant).toHaveBeenCalledOnce()
    expect(mocks.authorize).toHaveBeenCalledWith("venue:manage", TENANT)
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "read committed" })
    expect(mocks.values.mock.calls[0][0]).toMatchObject({ name: input.name, city: "Lahore", tenantId: TENANT })
    expect(mocks.values.mock.calls[1][0]).toMatchObject({
      tenantId: TENANT, actorId: USER_ID, actorRole: "league_owner", method: "VENUE_CREATE",
    })
    const locks = mocks.execute.mock.calls.map(([query]) => dialect.sqlToQuery(query))
    expect(locks.slice(0, 3).map((query) => query.params)).toEqual([[USER_ID], [TENANT], [USER_ID, TENANT]])
    expect(locks[0].sql).toContain("FOR UPDATE")
    expect(result).toEqual({ success: true, venue: { id: VENUE_ID, name: input.name, tenantId: TENANT } })
    expect(mocks.revalidate).toHaveBeenCalled()
  })

  it("rejects unauthenticated callers before resolving a tenant", async () => {
    mocks.auth.mockResolvedValue({ userId: null })
    await expect(createVenue(input)).rejects.toThrow("Unauthorized")
    expect(mocks.resolveTenant).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("fails closed without an active league and never opens a transaction", async () => {
    mocks.resolveTenant.mockResolvedValue(null)
    await expect(createVenue(input)).rejects.toThrow("Tenant not found")
    expect(mocks.authorize).not.toHaveBeenCalled()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })

  it("does not write when venue:manage is denied for the active league", async () => {
    mocks.authorize.mockRejectedValue(new Error("Forbidden"))
    await expect(createVenue(input)).rejects.toThrow("Forbidden")
    expect(mocks.transaction).not.toHaveBeenCalled()
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it("rejects a duplicate name with a friendly error before inserting", async () => {
    mocks.txVenue.mockResolvedValue({ id: "other", tenantId: TENANT, name: input.name })
    await expect(createVenue(input)).rejects.toThrow("already exists in this league")
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it("maps a unique-violation race to the friendly duplicate error", async () => {
    mocks.insertReturning.mockRejectedValue(Object.assign(new Error("duplicate key"), { code: "23505" }))
    await expect(createVenue(input)).rejects.toThrow("already exists in this league")
  })

  it("updates the locked venue row inside the exact league with an audit", async () => {
    mocks.txVenue.mockResolvedValue({ id: VENUE_ID, tenantId: TENANT, name: "Old name" })
    await updateVenue(VENUE_ID, { name: "New name" })

    const locks = mocks.execute.mock.calls.map(([query]) => dialect.sqlToQuery(query))
    expect(locks[3].params).toEqual([VENUE_ID, TENANT])
    expect(locks[3].sql).toContain("FOR UPDATE")
    expect(mocks.set.mock.calls[0][0]).toMatchObject({ name: "New name" })
    expect(mocks.values.mock.calls[0][0]).toMatchObject({ method: "VENUE_UPDATE", payload: { resourceId: VENUE_ID } })
  })

  it("refuses to update a venue that is not in the exact active league", async () => {
    mocks.txVenue.mockResolvedValue({ id: VENUE_ID, tenantId: OTHER_TENANT, name: "Foreign" })
    await expect(updateVenue(VENUE_ID, { name: "New name" })).rejects.toThrow("Venue not found")
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it("archives instead of deleting and records the transition", async () => {
    mocks.txVenue.mockResolvedValue({ id: VENUE_ID, tenantId: TENANT, name: "Ground", isActive: true })
    const result = await archiveVenue(VENUE_ID)

    expect(mocks.set.mock.calls[0][0]).toMatchObject({ isActive: false })
    const audit = mocks.values.mock.calls[0][0]
    expect(audit).toMatchObject({ method: "VENUE_ARCHIVE", payload: { resourceId: VENUE_ID,
      before: { isActive: true }, after: { isActive: false } } })
    expect(result).toEqual({ success: true, venue: { id: VENUE_ID, tenantId: TENANT, isActive: false } })
  })

  it("does not rewrite or audit a venue that is already in the requested state", async () => {
    mocks.txVenue.mockResolvedValue({ id: VENUE_ID, tenantId: TENANT, name: "Ground", isActive: false })
    await expect(archiveVenue(VENUE_ID)).rejects.toThrow("already archived")
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it("rejects a malformed venue id before opening a transaction", async () => {
    await expect(updateVenue("not-a-uuid", { name: "New name" })).rejects.toThrow()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
})
