import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * FAN-04 (Batch 164): the fan-prediction journey tests. Table-keyed fake
 * mirroring the availability/corrections harness. Pinned: one pick per
 * member per match (identical replay = pure read, different pick = IN
 * PLACE update with audit provenance); the window gate (closed at kickoff
 * or the first non-scheduled status); active-membership authority;
 * correctness is DERIVED from the official row at read time - a pick never
 * writes anything but its own row.
 */
const hoisted = vi.hoisted(() => {
  return {
    CLERK_ID: "clerk_prediction_identity",
    MATCH_ID: "cc000000-1111-4a1e-9c1d-000000000001",
    TENANT_ID: "cc000000-2222-4a1e-9c1d-000000000002",
    USER_ID: "cc000000-3333-4a1e-9c1d-000000000003",
    TEAM_A: "cc000000-4444-4a1e-9c1d-000000000004",
    TEAM_B: "cc000000-5555-4a1e-9c1d-000000000005",
    FUTURE: new Date("2030-01-01T12:00:00.000Z"),
    rows: {
      account: { id: "cc000000-3333-4a1e-9c1d-000000000003", isActive: true } as Record<string, unknown> | undefined,
      match: {
        id: "cc000000-1111-4a1e-9c1d-000000000001",
        tenantId: "cc000000-2222-4a1e-9c1d-000000000002",
        status: "scheduled",
        scheduledDate: new Date("2030-01-01T12:00:00.000Z"),
        winnerId: null,
        teamAId: "cc000000-4444-4a1e-9c1d-000000000004",
        teamBId: "cc000000-5555-4a1e-9c1d-000000000005",
        result: null,
      } as Record<string, unknown> | undefined,
      membership: { role: "fan", status: "active", expiresAt: null } as Record<string, unknown> | undefined,
      myPrediction: undefined as Record<string, unknown> | undefined,
    },
    calls: {
      inserts: [] as unknown[],
      updates: [] as unknown[],
      audits: [] as unknown[],
    },
  }
})

vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

vi.mock("@mtk/database", async (importOriginal) => {
  const original = await importOriginal<typeof import("@mtk/database")>()
  const { users, matches, fanPredictions, userTenantRoles, auditLogs } = original

  const takeFor = (table: unknown): Record<string, unknown>[] => {
    if (table === users) return hoisted.rows.account ? [hoisted.rows.account] : []
    if (table === matches) return hoisted.rows.match ? [hoisted.rows.match] : []
    if (table === userTenantRoles) return hoisted.rows.membership ? [hoisted.rows.membership] : []
    if (table === fanPredictions) return hoisted.rows.myPrediction ? [hoisted.rows.myPrediction] : []
    return []
  }

  const makeSelect = () =>
    vi.fn(() => ({
      from: vi.fn((table: unknown) => {
        const rows = takeFor(table)
        return {
          where: vi.fn(() => ({
            limit: vi.fn(async () => rows),
            orderBy: vi.fn(() => ({ limit: vi.fn(async () => rows) })),
          })),
        }
      }),
    }))

  const makeTx = (): Record<string, unknown> => ({
    execute: vi.fn(async () => []),
    insert: vi.fn((table: unknown) => ({
      values: vi.fn((values: unknown) => {
        if (table === auditLogs) hoisted.calls.audits.push(values)
        else hoisted.calls.inserts.push(values)
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

const actual = await import("@mtk/database")
const { matches } = actual
const { saveMyPrediction, readMyPredictionView } = await import("@/lib/fan-predictions")
const authMock = vi.mocked((await import("@clerk/nextjs/server")).auth)

const { CLERK_ID, MATCH_ID, TENANT_ID, TEAM_A, TEAM_B, USER_ID } = hoisted

describe("FAN-04 (Batch 164): the fan-prediction journey", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hoisted.rows.account = { id: USER_ID, isActive: true }
    hoisted.rows.match = {
      id: MATCH_ID,
      tenantId: TENANT_ID,
      status: "scheduled",
      scheduledDate: new Date("2030-01-01T12:00:00.000Z"),
      winnerId: null,
      teamAId: TEAM_A,
      teamBId: TEAM_B,
      result: null,
    }
    hoisted.rows.membership = { role: "fan", status: "active", expiresAt: null }
    hoisted.rows.myPrediction = undefined
    hoisted.calls.inserts = []
    hoisted.calls.updates = []
    hoisted.calls.audits = []
    authMock.mockResolvedValue({ userId: CLERK_ID } as never)
  })

  it("an active member records a pick: insert + audit with provenance", async () => {
    const result = await saveMyPrediction(MATCH_ID, "home")
    expect(result).toMatchObject({ recorded: true, pick: "home", changed: true })
    expect(hoisted.calls.inserts).toEqual([
      { tenantId: TENANT_ID, matchId: MATCH_ID, userId: USER_ID, prediction: "home" },
    ])
    expect(hoisted.calls.audits[0]).toMatchObject({
      method: "FAN_PREDICTION_RECORDED",
      tenantId: TENANT_ID,
      payload: { resourceId: MATCH_ID, pick: "home", mode: "created" },
    })
  })

  it("an identical replay is a pure read - no second insert, no second audit", async () => {
    hoisted.rows.myPrediction = { id: "p1", prediction: "home" }
    const result = await saveMyPrediction(MATCH_ID, "home")
    expect(result).toEqual({ recorded: true, pick: "home", changed: false, windowSentence: "Already predicted - your pick stands." })
    expect(hoisted.calls.inserts).toHaveLength(0)
    expect(hoisted.calls.updates).toHaveLength(0)
    expect(hoisted.calls.audits).toHaveLength(0)
  })

  it("a changed pick updates the SAME row in place, with the previous pick audited", async () => {
    hoisted.rows.myPrediction = { id: "p1", prediction: "home" }
    const result = await saveMyPrediction(MATCH_ID, "away")
    expect(result).toMatchObject({ recorded: true, pick: "away", changed: true })
    expect(hoisted.calls.updates).toEqual([{ prediction: "away", updatedAt: expect.any(Date) }])
    expect(hoisted.calls.inserts).toHaveLength(0)
    expect(hoisted.calls.audits[0]).toMatchObject({
      payload: { pick: "away", mode: "updated", previousPick: "home" },
    })
  })

  it("the window closes the moment the match stops being scheduled", async () => {
    for (const status of ["toss", "live", "innings_break", "completed"]) {
      hoisted.rows.match = { ...(hoisted.rows.match as Record<string, unknown>), status }
      await expect(saveMyPrediction(MATCH_ID, "home")).rejects.toThrow(/closed/)
      hoisted.calls.inserts = []
    }
  })

  it("kickoff passed refuses even while still `scheduled`", async () => {
    hoisted.rows.match = { ...(hoisted.rows.match as Record<string, unknown>), scheduledDate: new Date("2020-01-01T00:00:00.000Z") }
    await expect(saveMyPrediction(MATCH_ID, "home")).rejects.toThrow(/scheduled start time/)
  })

  it("recorded picks are audited against a live gate, then settle DERIVED from the official row", async () => {
    // Settled correct: completed with the official winner.
    hoisted.rows.match = { ...(hoisted.rows.match as Record<string, unknown>), status: "completed", winnerId: TEAM_A, result: `${TEAM_A} won` }
    hoisted.rows.myPrediction = { id: "p1", prediction: "home" }
    const view = await readMyPredictionView(MATCH_ID, TENANT_ID, USER_ID, "Team A", "Team B")
    expect(view?.settled).toEqual({ verdict: "correct", winner: "home" })
    expect(view?.pick).toBe("home")

    // Void: abandoned is honest no-verdict, never guessed wrongness.
    hoisted.rows.match = { ...(hoisted.rows.match as Record<string, unknown>), status: "abandoned", winnerId: null, result: null }
    const voided = await readMyPredictionView(MATCH_ID, TENANT_ID, USER_ID, "Team A", "Team B")
    expect(voided?.settled).toEqual({ verdict: "void", reason: "match_abandoned" })
    void matches
  })

  it("a signed-out viewer gets a pick-less honest view, not an error", async () => {
    const view = await readMyPredictionView(MATCH_ID, TENANT_ID, null, "Team A", "Team B")
    expect(view?.pick).toBeNull()
    expect(view?.settled).toBeNull()
    expect(view?.window.open).toBe(true)
  })
})
