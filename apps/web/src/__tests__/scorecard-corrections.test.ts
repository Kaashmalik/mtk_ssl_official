import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * REG-05 (Batch 141): correction-request journey tests. Same discipline as
 * the availability harness: vi.hoisted state, factory-resolved table
 * identity, one matchBalls-style chain per read bucket. Requests are
 * records, never mutations - the tests pin that the writers never touch
 * scorecard data, only the request rows.
 */
const hoisted = vi.hoisted(() => {
  const MATCH_ID = "c2d88f4f-1111-4a1e-9c1d-000000000001"
  const TENANT_ID = "c2d88f4f-2222-4a1e-9c1d-000000000002"
  const USER_ID = "c2d88f4f-3333-4a1e-9c1d-000000000003"
  const REQUEST_ID = "c2d88f4f-4444-4a1e-9c1d-000000000004"
  return {
    CLERK_ID: "clerk_correction_identity",
    MATCH_ID,
    TENANT_ID,
    USER_ID,
    REQUEST_ID,
    rows: {
      account: { id: USER_ID, isActive: true } as Record<string, unknown> | undefined,
      match: { id: MATCH_ID, tenantId: TENANT_ID, status: "completed" } as
        | Record<string, unknown>
        | undefined,
      membership: { userId: USER_ID, tenantId: TENANT_ID, role: "member", status: "active", expiresAt: null } as
        | Record<string, unknown>
        | undefined,
      request: undefined as Record<string, unknown> | undefined,
      requestById: undefined as Record<string, unknown> | undefined,
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
  const { matches, scorecardCorrectionRequests, userTenantRoles, users, auditLogs } = original

  const bucketFor = (table: unknown): Record<string, unknown> | undefined | "missing" => {
    if (table === users) return hoisted.rows.account ?? undefined
    if (table === matches) return hoisted.rows.match ?? undefined
    if (table === scorecardCorrectionRequests) {
      // Two read shapes hit this table: open-request lookup and id lookup.
      return hoisted.rows.request ?? hoisted.rows.requestById ?? undefined
    }
    if (table === userTenantRoles) return hoisted.rows.membership ?? undefined
    return "missing"
  }

  const makeSelect = () =>
    vi.fn(() => ({
      from: vi.fn((table: unknown) => {
        if (bucketFor(table) === "missing") throw new Error("fake select: unexpected table")
        return {
          where: vi.fn(() => ({
            limit: vi.fn(async () => {
              const row = bucketFor(table)
              return row ? [row] : []
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
      values: vi.fn((values: unknown) => {
        // Writers await plain values() (audit rows) AND call .returning()
        // (request rows) - record at values-time so both paths are seen.
        if (table === auditLogs) hoisted.calls.audits.push(values)
        else hoisted.calls.inserts.push(values)
        return {
          returning: vi.fn(async () => [{ id: hoisted.REQUEST_ID }]),
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
const { matches, scorecardCorrectionRequests } = actual
const { submitScorecardCorrection, resolveScorecardCorrection } = await import("@/lib/scorecard-corrections")
const { raiseScorecardCorrection, resolveScorecardCorrectionRequest } = await import("@/app/actions/scorecard-corrections")
const authMock = vi.mocked((await import("@clerk/nextjs/server")).auth)

const { CLERK_ID, MATCH_ID, TENANT_ID, USER_ID, REQUEST_ID } = hoisted

describe("REG-05 (Batch 141): the correction-request journey", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hoisted.rows.account = { id: USER_ID, isActive: true }
    hoisted.rows.match = { id: MATCH_ID, tenantId: TENANT_ID, status: "completed" }
    hoisted.rows.membership = { userId: USER_ID, tenantId: TENANT_ID, role: "member", status: "active", expiresAt: null }
    hoisted.rows.request = undefined
    hoisted.rows.requestById = undefined
    hoisted.calls.inserts = []
    hoisted.calls.updates = []
    hoisted.calls.audits = []
    hoisted.calls.transactionEntered = 0
    authMock.mockResolvedValue({ userId: CLERK_ID } as never)
  })

  it("a member raises the first request: row + audit, and the scorecard itself is NEVER touched", async () => {
    const result = await submitScorecardCorrection(MATCH_ID, "wrong_runs")
    expect(result).toEqual({ raised: true, requestId: REQUEST_ID, changed: true })
    expect(hoisted.calls.inserts).toEqual([
      { tenantId: TENANT_ID, matchId: MATCH_ID, requestedBy: USER_ID, reason: "wrong_runs" },
    ])
    expect(hoisted.calls.updates).toHaveLength(0)
    expect(hoisted.calls.audits[0]).toMatchObject({ actorId: USER_ID, tenantId: TENANT_ID, method: "SCORECARD_CORRECTION_RAISED" })
  })

  it("refuses a non-member and writes nothing", async () => {
    hoisted.rows.membership = { userId: USER_ID, tenantId: TENANT_ID, role: "member", status: "suspended", expiresAt: null }
    await expect(submitScorecardCorrection(MATCH_ID, "wrong_runs")).rejects.toThrow(/not an active member/)
    expect(hoisted.calls.inserts).toHaveLength(0)
  })

  it("refuses a match that has no scorecard yet (honest refusal, not fake acceptance)", async () => {
    hoisted.rows.match = { id: MATCH_ID, tenantId: TENANT_ID, status: "draft" }
    await expect(submitScorecardCorrection(MATCH_ID, "wrong_runs")).rejects.toThrow(/no scorecard yet/)
    expect(hoisted.calls.inserts).toHaveLength(0)
  })

  it("an identical replay of the OPEN request is a pure read", async () => {
    hoisted.rows.request = { id: REQUEST_ID, reason: "wrong_wicket", status: "open" }
    const result = await submitScorecardCorrection(MATCH_ID, "wrong_wicket")
    expect(result).toEqual({ raised: true, requestId: REQUEST_ID, changed: false })
    expect(hoisted.calls.inserts).toHaveLength(0)
    expect(hoisted.calls.audits).toHaveLength(0)
  })

  it("a DIFFERENT reason while one is open refuses - a raised record is not silently rewritten", async () => {
    hoisted.rows.request = { id: REQUEST_ID, reason: "wrong_wicket", status: "open" }
    await expect(submitScorecardCorrection(MATCH_ID, "other")).rejects.toThrow(/already have an open correction request/)
    expect(hoisted.calls.inserts).toHaveLength(0)
  })

  it("only the league owner resolves; a plain member cannot", async () => {
    hoisted.rows.requestById = { id: REQUEST_ID, tenantId: TENANT_ID, status: "open" }
    await expect(resolveScorecardCorrection(REQUEST_ID, "approved")).rejects.toThrow(/only the league owner/)
    expect(hoisted.calls.updates).toHaveLength(0)
  })

  it("the owner resolves an open request with provenance (resolvedBy + resolvedAt + audit)", async () => {
    hoisted.rows.requestById = { id: REQUEST_ID, tenantId: TENANT_ID, status: "open" }
    hoisted.rows.membership = { userId: USER_ID, tenantId: TENANT_ID, role: "league_owner", status: "active", expiresAt: null }
    const result = await resolveScorecardCorrection(REQUEST_ID, "approved")
    expect(result).toEqual({ resolved: true, status: "approved" })
    expect(hoisted.calls.updates).toHaveLength(1)
    expect(hoisted.calls.updates[0]).toMatchObject({ status: "approved" })
    expect(hoisted.calls.audits).toHaveLength(1)
    expect(hoisted.calls.audits[0]).toMatchObject({ actorRole: "league_owner", method: "SCORECARD_CORRECTION_RESOLVED" })
  })

  it("a resolution replay on a terminal request is a pure read", async () => {
    hoisted.rows.requestById = { id: REQUEST_ID, tenantId: TENANT_ID, status: "dismissed" }
    hoisted.rows.membership = { userId: USER_ID, tenantId: TENANT_ID, role: "league_owner", status: "active", expiresAt: null }
    const result = await resolveScorecardCorrection(REQUEST_ID, "dismissed")
    expect(result).toEqual({ resolved: true, status: "dismissed" })
    expect(hoisted.calls.updates).toHaveLength(0)
    expect(hoisted.calls.audits).toHaveLength(0)
  })

  it("the actions refuse malformed intents before any transaction", async () => {
    await expect(raiseScorecardCorrection({ matchId: "nope", reason: "wrong_runs" })).rejects.toThrow()
    await expect(raiseScorecardCorrection({ matchId: MATCH_ID, reason: "free_text" })).rejects.toThrow()
    await expect(resolveScorecardCorrectionRequest({ requestId: "nope", decision: "approved" })).rejects.toThrow()
    await expect(resolveScorecardCorrectionRequest({ requestId: REQUEST_ID, decision: "maybe" })).rejects.toThrow()
    expect(hoisted.calls.transactionEntered).toBe(0)
  })

  it("shape pin: the writer's real tables and policy export exist", () => {
    expect(matches.tenantId).toBeTruthy()
    expect(scorecardCorrectionRequests.tenantId).toBeTruthy()
    expect(actual.CORRECTION_REASONS).toContain("wrong_runs")
  })
})
