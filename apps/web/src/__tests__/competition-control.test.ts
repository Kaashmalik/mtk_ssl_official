import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * COMP-07 (Batch 153): the competition-control journey (forfeit /
 * postpone / reschedule). Queue-keyed fake mirroring the tournament-
 * application harness. Pinned: owner-only authority, terminal result
 * states refuse every control move, forfeit/postpone carry a required
 * reason, reschedule clears the postponement reason and returns a
 * postponed match to "scheduled", every move is audited with provenance,
 * and idempotent replays are pure reads (no second write, no audit).
 */
const hoisted = vi.hoisted(() => {
  const MATCH_ID = "bb000000-1111-4a1e-9c1d-000000000001"
  const TENANT_ID = "bb000000-2222-4a1e-9c1d-000000000002"
  const USER_ID = "bb000000-3333-4a1e-9c1d-000000000003"
  return {
    CLERK_ID: "clerk_competition_control",
    MATCH_ID,
    TENANT_ID,
    USER_ID,
    rows: {
      account: { id: USER_ID, isActive: true } as Record<string, unknown> | undefined,
      match: { id: MATCH_ID, tenantId: TENANT_ID, status: "live" } as Record<string, unknown> | undefined,
      membership: { userId: USER_ID, tenantId: TENANT_ID, role: "league_owner", status: "active", expiresAt: null } as
        | Record<string, unknown>
        | undefined,
    },
    calls: {
      updates: [] as unknown[],
      audits: [] as unknown[],
    },
  }
})

vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

vi.mock("@mtk/database", async (importOriginal) => {
  const original = await importOriginal<typeof import("@mtk/database")>()
  const { auditLogs, matches, userTenantRoles, users } = original

  const takeFor = (table: unknown): Record<string, unknown>[] | "missing" => {
    if (table === users) return hoisted.rows.account ? [hoisted.rows.account] : []
    if (table === matches) return hoisted.rows.match ? [hoisted.rows.match] : []
    if (table === userTenantRoles) return hoisted.rows.membership ? [hoisted.rows.membership] : []
    return "missing"
  }

  const makeSelect = () =>
    vi.fn(() => ({
      from: vi.fn((table: unknown) => {
        const rows = takeFor(table)
        if (rows === "missing") throw new Error("unexpected table")
        return {
          where: vi.fn(() => ({ limit: vi.fn(async () => rows) })),
          limit: vi.fn(async () => rows),
          innerJoin: vi.fn(() => ({ where: vi.fn(async () => []) })),
          orderBy: vi.fn(() => ({ limit: vi.fn(async () => []) })),
        }
      }),
    }))

  const makeTx = (): Record<string, unknown> => ({
    execute: vi.fn(async () => []),
    insert: vi.fn((table: unknown) => ({
      values: vi.fn((values: unknown) => {
        if (table === auditLogs) hoisted.calls.audits.push(values)
        return {
          returning: vi.fn(async () => [{ id: hoisted.MATCH_ID }]),
          then: (resolve: (v: unknown) => unknown) => Promise.resolve().then(() => resolve(undefined)),
        }
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
        vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(makeTx())),
        { query: {} },
      ),
    },
  }
})

const { forfeitMatch, postponeMatch, rescheduleMatch } = await import("@/lib/competition-control")
const authMock = vi.mocked((await import("@clerk/nextjs/server")).auth)

const { CLERK_ID, MATCH_ID, TENANT_ID, USER_ID } = hoisted

describe("COMP-07 (Batch 153): the competition-control journey", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    authMock.mockResolvedValue({ userId: CLERK_ID } as never)
    hoisted.rows.account = { id: USER_ID, isActive: true }
    hoisted.rows.match = { id: MATCH_ID, tenantId: TENANT_ID, status: "live" }
    hoisted.rows.membership = {
      userId: USER_ID,
      tenantId: TENANT_ID,
      role: "league_owner",
      status: "active",
      expiresAt: null,
    }
    hoisted.calls.updates = []
    hoisted.calls.audits = []
  })

  it("forfeits an open match with a required reason and an honest audit trail", async () => {
    await expect(forfeitMatch(MATCH_ID, "  Team failed to appear  ")).resolves.toEqual({ forfeited: true, changed: true })
    const update = hoisted.calls.updates[0] as Record<string, unknown>
    expect(update.status).toBe("forfeited")
    expect(update.forfeitReason).toBe("Team failed to appear")
    const audit = hoisted.calls.audits[0] as Record<string, unknown>
    expect(audit.actorId).toBe(USER_ID)
    expect(audit.tenantId).toBe(TENANT_ID)
    expect(audit.payload).toMatchObject({ reason: "Team failed to appear", from: "live" })
  })

  it("refuses a forfeit with an empty reason before any write happens", async () => {
    await expect(forfeitMatch(MATCH_ID, "   ")).rejects.toThrow(/reason is required/i)
    expect(hoisted.calls.updates).toHaveLength(0)
    expect(hoisted.calls.audits).toHaveLength(0)
  })

  it("refuses to rewrite a completed result into a forfeit - corrections are a separate audited path", async () => {
    hoisted.rows.match = { id: MATCH_ID, tenantId: TENANT_ID, status: "completed" }
    await expect(forfeitMatch(MATCH_ID, "late scorer correction")).rejects.toThrow(/open match/i)
    expect(hoisted.calls.updates).toHaveLength(0)
  })

  it("refuses non-owner control moves outright", async () => {
    hoisted.rows.membership = { userId: USER_ID, tenantId: TENANT_ID, role: "member", status: "active", expiresAt: null }
    await expect(forfeitMatch(MATCH_ID, "attempted by member")).rejects.toThrow(/only the league owner/i)
    expect(hoisted.calls.updates).toHaveLength(0)
  })

  it("treats an already-forfeited match as a pure replay read", async () => {
    hoisted.rows.match = { id: MATCH_ID, tenantId: TENANT_ID, status: "forfeited" }
    await expect(forfeitMatch(MATCH_ID, "second attempt")).resolves.toEqual({ forfeited: true, changed: false })
    expect(hoisted.calls.updates).toHaveLength(0)
    expect(hoisted.calls.audits).toHaveLength(0)
  })

  it("postpones with a reason and keeps status separate from result", async () => {
    await expect(postponeMatch(MATCH_ID, "ground double-booked")).resolves.toEqual({ postponed: true, changed: true })
    const update = hoisted.calls.updates[0] as Record<string, unknown>
    expect(update.status).toBe("postponed")
    expect(update.postponementReason).toBe("ground double-booked")
  })

  it("refuses to postpone a match that already has a recorded result", async () => {
    hoisted.rows.match = { id: MATCH_ID, tenantId: TENANT_ID, status: "no_result" }
    await expect(postponeMatch(MATCH_ID, "rain re-run")).rejects.toThrow(/open match/i)
    expect(hoisted.calls.updates).toHaveLength(0)
  })

  it("reschedules a postponed match back to scheduled and clears the postponement reason", async () => {
    hoisted.rows.match = { id: MATCH_ID, tenantId: TENANT_ID, status: "postponed" }
    await expect(rescheduleMatch(MATCH_ID, "2026-11-01T09:30:00.000Z")).resolves.toEqual({ rescheduled: true, changed: true })
    const update = hoisted.calls.updates[0] as Record<string, unknown>
    expect(update.status).toBe("scheduled")
    expect(update.postponementReason).toBeNull()
    expect((update.scheduledDate as Date).toISOString()).toBe("2026-11-01T09:30:00.000Z")
  })

  it("reschedules a scheduled match in place without touching its status", async () => {
    hoisted.rows.match = { id: MATCH_ID, tenantId: TENANT_ID, status: "scheduled" }
    const auditBefore = hoisted.calls.audits.length
    await expect(rescheduleMatch(MATCH_ID, "2026-11-02T13:00:00.000Z")).resolves.toEqual({ rescheduled: true, changed: true })
    const update = hoisted.calls.updates[0] as Record<string, unknown>
    expect(update.status).toBe("scheduled")
    expect(hoisted.calls.updates).toHaveLength(1)
    expect(hoisted.calls.audits.length).toBe(auditBefore + 1)
  })

  it("refuses to reschedule a closed match and refuses an invalid date outright", async () => {
    hoisted.rows.match = { id: MATCH_ID, tenantId: TENANT_ID, status: "completed" }
    await expect(rescheduleMatch(MATCH_ID, "2026-11-05T10:00:00.000Z")).rejects.toThrow(/rescheduled/i)
    expect(hoisted.calls.updates).toHaveLength(0)
    await expect(rescheduleMatch(MATCH_ID, "not-a-date")).rejects.toThrow(/valid date/i)
  })
})
