import { beforeEach, describe, expect, it, vi } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import { createVenueRecord, updateVenueRecord, setVenueActive } from "@/lib/venue-writes"

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(), execute: vi.fn(),
  txUser: vi.fn(), txLeague: vi.fn(), txMember: vi.fn(), txVenueFindFirst: vi.fn(),
  insert: vi.fn(), values: vi.fn(), returning: vi.fn(),
  update: vi.fn(), set: vi.fn(), where: vi.fn(),
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

function locks() {
  return mocks.execute.mock.calls.map(([query]) => dialect.sqlToQuery(query))
}

describe("Venue writers are locked, scoped and audited", () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.execute.mockResolvedValue([])
    mocks.txUser.mockResolvedValue({ id: USER_ID, clerkId: CLERK_ID, isActive: true })
    mocks.txLeague.mockResolvedValue({ id: TENANT, isActive: true })
    mocks.txMember.mockResolvedValue({ userId: USER_ID, tenantId: TENANT, role: "league_owner", status: "active" })
    mocks.txVenueFindFirst.mockResolvedValue(undefined)
    mocks.insert.mockReturnValue({ values: mocks.values })
    mocks.values.mockImplementation(() => ({
      returning: mocks.returning,
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(undefined).then(resolve),
    }))
    mocks.update.mockReturnValue({ set: mocks.set })
    mocks.set.mockReturnValue({ where: mocks.where })
    mocks.where.mockReturnValue({ returning: mocks.returning })
    mocks.returning.mockResolvedValue([{ id: VENUE_ID, tenantId: TENANT }])
    mocks.transaction.mockImplementation(async (fn: any) => fn({
      execute: mocks.execute, insert: mocks.insert, update: mocks.update,
      query: { users: { findFirst: mocks.txUser }, tenants: { findFirst: mocks.txLeague },
        userTenantRoles: { findFirst: mocks.txMember }, venues: { findFirst: mocks.txVenueFindFirst } },
    }))
  })

  it("creates under the account -> league -> membership lock in one audited transaction", async () => {
    const created = await createVenueRecord(CLERK_ID, TENANT, { name: "Gaddafi Stadium", city: "Lahore" })

    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "read committed" })
    const ordered = locks()
    expect(ordered.slice(0, 3).map((query) => query.params)).toEqual([[USER_ID], [TENANT], [USER_ID, TENANT]])
    expect(ordered[0].sql).toContain("FOR UPDATE")
    expect(mocks.values.mock.calls[0][0]).toMatchObject({ name: "Gaddafi Stadium", tenantId: TENANT })
    expect(mocks.values.mock.calls[1][0]).toMatchObject({
      tenantId: TENANT, actorId: USER_ID, actorRole: "league_owner", method: "VENUE_CREATE",
    })
    expect(created).toMatchObject({ id: VENUE_ID })
  })

  it("rejects a duplicate name with a friendly error before inserting", async () => {
    mocks.txVenueFindFirst.mockResolvedValue({ id: "other", tenantId: TENANT, name: "Gaddafi Stadium" })
    await expect(createVenueRecord(CLERK_ID, TENANT, { name: "Gaddafi Stadium" }))
      .rejects.toThrow("already exists in this league")
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it("maps a unique-violation race to the friendly duplicate error", async () => {
    mocks.returning.mockRejectedValue(Object.assign(new Error("duplicate key"), { code: "23505" }))
    await expect(createVenueRecord(CLERK_ID, TENANT, { name: "Gaddafi Stadium" }))
      .rejects.toThrow("already exists in this league")
  })

  it("fails closed when the writer's own membership is not the current league owner", async () => {
    mocks.txMember.mockResolvedValue({ userId: USER_ID, tenantId: TENANT, role: "team_manager", status: "active" })
    await expect(createVenueRecord(CLERK_ID, TENANT, { name: "Gaddafi Stadium" }))
      .rejects.toThrow("your venue access changed")
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it("rejects a stale clerk identity that is not the resolved account", async () => {
    mocks.txUser.mockResolvedValue({ id: USER_ID, clerkId: "different_clerk_id", isActive: true })
    await expect(createVenueRecord(CLERK_ID, TENANT, { name: "Gaddafi Stadium" }))
      .rejects.toThrow("your venue access changed")
  })

  it("locks the venue row after the context locks and audits an update", async () => {
    mocks.txVenueFindFirst.mockResolvedValue({ id: VENUE_ID, tenantId: TENANT, name: "Old name" })
    await updateVenueRecord(CLERK_ID, TENANT, VENUE_ID, { name: "New name" })

    const ordered = locks()
    expect(ordered[3].params).toEqual([VENUE_ID, TENANT])
    expect(ordered[3].sql).toContain("FOR UPDATE")
    expect(mocks.set.mock.calls[0][0]).toMatchObject({ name: "New name" })
    expect(mocks.values.mock.calls[0][0]).toMatchObject({ method: "VENUE_UPDATE", payload: { resourceId: VENUE_ID } })
  })

  it("refuses to update a venue that is not in the exact active league", async () => {
    mocks.txVenueFindFirst.mockResolvedValue({ id: VENUE_ID, tenantId: OTHER_TENANT, name: "Foreign" })
    await expect(updateVenueRecord(CLERK_ID, TENANT, VENUE_ID, { name: "New name" }))
      .rejects.toThrow("Venue not found")
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it("archives by compare-and-set instead of deleting, and records the transition", async () => {
    mocks.txVenueFindFirst.mockResolvedValue({ id: VENUE_ID, tenantId: TENANT, name: "Ground", isActive: true })
    await setVenueActive(CLERK_ID, TENANT, VENUE_ID, false)

    expect(mocks.set.mock.calls[0][0]).toMatchObject({ isActive: false })
    expect(mocks.values.mock.calls[0][0]).toMatchObject({ method: "VENUE_ARCHIVE", payload: { resourceId: VENUE_ID,
      before: { isActive: true }, after: { isActive: false } } })
  })

  it("does not rewrite or audit a venue that is already in the requested state", async () => {
    mocks.txVenueFindFirst.mockResolvedValue({ id: VENUE_ID, tenantId: TENANT, name: "Ground", isActive: false })
    await expect(setVenueActive(CLERK_ID, TENANT, VENUE_ID, false)).rejects.toThrow("already archived")
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it("rejects a malformed venue id before opening a transaction", async () => {
    await expect(updateVenueRecord(CLERK_ID, TENANT, "not-a-uuid", { name: "New name" })).rejects.toThrow()
    expect(mocks.transaction).not.toHaveBeenCalled()
  })
})
