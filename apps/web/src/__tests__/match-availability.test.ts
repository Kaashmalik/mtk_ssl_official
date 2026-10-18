import { beforeEach, describe, expect, it, vi } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

/**
 * REG-05 (Batch 138): availability journey tests. The harness is a
 * chainable fake transaction keyed by the REAL drizzle table objects
 * (resolved inside the factory), because the writer's reads are
 * projection chains, not repo helpers. setMyAvailability is the system
 * under test; the action's schema boundary is exercised separately.
 *
 * All mutable state lives in vi.hoisted containers: the @mtk/database
 * mock factory is hoisted above every top-level const, so the factory
 * closes over vi.hoisted state only.
 */
const hoisted = vi.hoisted(() => {
  const MATCH_ID = "b1c79e3e-1111-4a1e-9c1d-000000000001"
  const TENANT_ID = "b1c79e3e-2222-4a1e-9c1d-000000000002"
  const USER_TABLE_ID = "b1c79e3e-3333-4a1e-9c1d-000000000003"
  return {
    CLERK_ID: "clerk_avail_identity",
    MATCH_ID,
    TENANT_ID,
    USER_TABLE_ID,
    AVAIL_ROW_ID: "b1c79e3e-4444-4a1e-9c1d-000000000004",
    rows: {
      account: { id: USER_TABLE_ID, isActive: true } as Record<string, unknown> | undefined,
      match: { id: MATCH_ID, tenantId: TENANT_ID, status: "scheduled" } as
        | Record<string, unknown>
        | undefined,
      membership: { userId: USER_TABLE_ID, tenantId: TENANT_ID, role: "member", status: "active", expiresAt: null } as
        | Record<string, unknown>
        | undefined,
      availability: undefined as Record<string, unknown> | undefined,
    },
    calls: {
      inserts: [] as unknown[],
      updates: [] as unknown[],
      audits: [] as unknown[],
      transactionEntered: 0,
    },
  }
})

vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

vi.mock("@mtk/database", async (importOriginal) => {
  const original = await importOriginal<typeof import("@mtk/database")>()
  const { matches, matchAvailability, userTenantRoles, users, auditLogs } = original
  const { rows } = hoisted

  const makeSelect = () =>
    vi.fn(() => ({
      from: vi.fn((table: unknown) => {
        if (table !== matches && table !== matchAvailability && table !== userTenantRoles && table !== users) {
          throw new Error("fake select: unexpected table")
        }
        return {
          where: vi.fn(() => ({
            limit: vi.fn(async () => {
              if (table === users) return rows.account ? [rows.account] : []
              if (table === matches) return rows.match ? [rows.match] : []
              if (table === matchAvailability) return rows.availability ? [rows.availability] : []
              if (table === userTenantRoles) return rows.membership ? [rows.membership] : []
              return []
            }),
          })),
          innerJoin: vi.fn(() => ({ where: vi.fn(async () => []) })),
          orderBy: vi.fn(() => ({ limit: vi.fn(async () => []) })),
        }
      }),
    }))

  const makeTx = (): Record<string, unknown> => ({
    execute: vi.fn(async () => []),
    insert: vi.fn((table: unknown) => ({
      values: vi.fn(async (values: unknown) => {
        if (table === auditLogs) hoisted.calls.audits.push(values)
        else hoisted.calls.inserts.push(values)
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((set: unknown) => ({
        where: vi.fn(async () => {
          hoisted.calls.updates.push(set)
        }),
      })),
    })),
    select: makeSelect(),
  })

  return {
    ...original,
    db: {
      select: makeSelect(),
      transaction: Object.assign(
        vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
          hoisted.calls.transactionEntered += 1
          return fn(makeTx())
        }),
        { query: {} },
      ),
    },
  }
})

const actual = await import("@mtk/database")
const { matches, matchAvailability, membershipGrantsAccess } = actual
const { setMyAvailability } = await import("@/lib/match-availability")
const { setMatchAvailability } = await import("@/app/actions/match-availability")
const authMock = vi.mocked((await import("@clerk/nextjs/server")).auth)

const { CLERK_ID, MATCH_ID, TENANT_ID, USER_TABLE_ID, AVAIL_ROW_ID } = hoisted

describe("REG-05 (Batch 138): the member availability journey", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hoisted.rows.account = { id: USER_TABLE_ID, isActive: true }
    hoisted.rows.match = { id: MATCH_ID, tenantId: TENANT_ID, status: "scheduled" }
    hoisted.rows.membership = { userId: USER_TABLE_ID, tenantId: TENANT_ID, role: "member", status: "active", expiresAt: null }
    hoisted.rows.availability = undefined
    hoisted.calls.inserts = []
    hoisted.calls.updates = []
    hoisted.calls.audits = []
    hoisted.calls.transactionEntered = 0
    authMock.mockResolvedValue({ userId: CLERK_ID } as never)
  })

  it("records an active member's first answer with an audit row", async () => {
    const result = await setMyAvailability(MATCH_ID, "available")
    expect(result).toEqual({ recorded: true, status: "available", changed: true })
    expect(hoisted.calls.inserts).toEqual([
      { tenantId: TENANT_ID, matchId: MATCH_ID, userId: USER_TABLE_ID, status: "available" },
    ])
    expect(hoisted.calls.audits).toHaveLength(1)
    expect(hoisted.calls.audits[0]).toMatchObject({
      actorId: USER_TABLE_ID,
      tenantId: TENANT_ID,
      method: "MATCH_AVAILABILITY_RECORDED",
  })
    expect((hoisted.calls.audits[0] as Record<string, unknown>).payload).toMatchObject({
      resourceId: MATCH_ID,
      status: "available",
      replay: "first",
    })
  })

  it("refuses a non-member with the honest FORBIDDEN reason and never writes", async () => {
    hoisted.rows.membership = { userId: USER_TABLE_ID, tenantId: TENANT_ID, role: "member", status: "suspended", expiresAt: null }
    await expect(setMyAvailability(MATCH_ID, "available")).rejects.toThrow(/not an active member/)
    expect(hoisted.calls.inserts).toHaveLength(0)
    expect(hoisted.calls.audits).toHaveLength(0)
  })

  it("refuses a terminal match - availability after the result is theatre", async () => {
    hoisted.rows.match = { id: MATCH_ID, tenantId: TENANT_ID, status: "completed" }
    await expect(setMyAvailability(MATCH_ID, "available")).rejects.toThrow(/no longer be recorded/)
    expect(hoisted.calls.inserts).toHaveLength(0)
  })

  it("an identical replay is a pure read: no insert, no update, no second audit", async () => {
    hoisted.rows.availability = { id: AVAIL_ROW_ID, status: "maybe" }
    const result = await setMyAvailability(MATCH_ID, "maybe")
    expect(result).toEqual({ recorded: true, status: "maybe", changed: false })
    expect(hoisted.calls.inserts).toHaveLength(0)
    expect(hoisted.calls.updates).toHaveLength(0)
    expect(hoisted.calls.audits).toHaveLength(0)
  })

  it("re-answering updates the same row in place with fresh provenance", async () => {
    hoisted.rows.availability = { id: AVAIL_ROW_ID, status: "available" }
    const result = await setMyAvailability(MATCH_ID, "unavailable")
    expect(result).toEqual({ recorded: true, status: "unavailable", changed: true })
    expect(hoisted.calls.updates).toHaveLength(1)
    expect(hoisted.calls.updates[0]).toMatchObject({ status: "unavailable" })
    expect(hoisted.calls.inserts).toHaveLength(0)
    expect(hoisted.calls.audits).toHaveLength(1)
    expect((hoisted.calls.audits[0] as Record<string, unknown>).payload).toMatchObject({ replay: "updated" })
  })

  it("a malformed status refuses BEFORE any transaction begins", async () => {
    await expect(setMyAvailability(MATCH_ID, "definitely")).rejects.toThrow()
    expect(hoisted.calls.transactionEntered).toBe(0)
  })

  it("the action's schema refuses a malformed match id before the writer", async () => {
    await expect(setMatchAvailability({ matchId: "not-a-uuid", status: "available" })).rejects.toThrow()
    expect(hoisted.calls.transactionEntered).toBe(0)
  })

  it("the action threads a valid intent to the writer", async () => {
    const result = await setMatchAvailability({ matchId: MATCH_ID, status: "unavailable" })
    expect(result).toEqual({ success: true, status: "unavailable", changed: true })
    expect(hoisted.calls.inserts).toHaveLength(1)
  })

  it("the dialect accepts the writer's real table set (shape pin)", () => {
    expect(matches.tenantId).toBeTruthy()
    expect(matchAvailability.tenantId).toBeTruthy()
    expect(membershipGrantsAccess(hoisted.rows.membership as never)).toBe(true)
    expect(new PgDialect().sqlToQuery(sql`SELECT 1`).sql).toContain("SELECT 1")
  })
})
