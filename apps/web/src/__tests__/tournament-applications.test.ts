import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * REG-03 (Batch 147): the tournament-application journey tests. Queue-
 * keyed fake (the writers read the applications table in a defined
 * order: submit = live-lookup then approved-lookup; withdraw/decide =
 * id-lookup), mirroring the corrections/availability harness. Pinned:
 * only application rows are ever written; the state machine moves come
 * from the pure policy; withdrawal resolves with a time and NO decider;
 * decisions carry provenance and are owner-only.
 */
const hoisted = vi.hoisted(() => {
  const TOURNAMENT_ID = "aa000000-1111-4a1e-9c1d-000000000001"
  const TENANT_ID = "aa000000-2222-4a1e-9c1d-000000000002"
  const USER_ID = "aa000000-3333-4a1e-9c1d-000000000003"
  const TEAM_ID = "aa000000-4444-4a1e-9c1d-000000000004"
  const APP_ID = "aa000000-5555-4a1e-9c1d-000000000005"
  return {
    CLERK_ID: "clerk_application_identity",
    TOURNAMENT_ID,
    TENANT_ID,
    USER_ID,
    TEAM_ID,
    APP_ID,
    rows: {
      account: { id: USER_ID, isActive: true } as Record<string, unknown> | undefined,
      tournament: { id: TOURNAMENT_ID, tenantId: TENANT_ID, status: "registration" } as
        | Record<string, unknown>
        | undefined,
      team: { id: TEAM_ID, managerId: USER_ID, isActive: true } as Record<string, unknown> | undefined,
      membership: { userId: USER_ID, tenantId: TENANT_ID, role: "member", status: "active", expiresAt: null } as
        | Record<string, unknown>
        | undefined,
      applicationById: undefined as Record<string, unknown> | undefined,
    },
    appsQueue: [] as Array<Record<string, unknown> | undefined>,
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
  const { teams, tournamentApplications, tournaments, userTenantRoles, users, auditLogs } = original

  // Resolves the rows for ONE select call exactly once: from() captures
  // them, limit() reuses - the queue below must never double-consume.
  const takeFor = (table: unknown): Record<string, unknown>[] | "missing" => {
    if (table === users) return hoisted.rows.account ? [hoisted.rows.account] : []
    if (table === tournaments) return hoisted.rows.tournament ? [hoisted.rows.tournament] : []
    if (table === teams) return hoisted.rows.team ? [hoisted.rows.team] : []
    if (table === userTenantRoles) return hoisted.rows.membership ? [hoisted.rows.membership] : []
    if (table === tournamentApplications) {
      // An explicit id-lookup row (withdraw/decide) wins; otherwise the
      // defined-read-order queue drives submit (live-lookup then
      // approved-lookup).
      if (hoisted.rows.applicationById) return [hoisted.rows.applicationById]
      const next = hoisted.appsQueue.shift()
      return next ? [next] : []
    }
    return "missing"
  }

  const makeSelect = () =>
    vi.fn(() => ({
      from: vi.fn((table: unknown) => {
        const rows = takeFor(table)
        if (rows === "missing") throw new Error("fake select: unexpected table")
        return {
          where: vi.fn(() => ({
            limit: vi.fn(async () => rows),
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
        // (application rows) - record at values-time so both paths are seen.
        if (table === auditLogs) hoisted.calls.audits.push(values)
        else hoisted.calls.inserts.push(values)
        return {
          returning: vi.fn(async () => [{ id: hoisted.APP_ID }]),
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
const { teams, tournamentApplications, tournaments } = actual
const { decideTournamentApplication, submitTournamentApplication, withdrawTournamentApplication } = await import(
  "@/lib/tournament-applications"
)
const authMock = vi.mocked((await import("@clerk/nextjs/server")).auth)

const { APP_ID, CLERK_ID, TEAM_ID, TENANT_ID, TOURNAMENT_ID, USER_ID } = hoisted

describe("REG-03 (Batch 147): the tournament-application journey", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hoisted.rows.account = { id: USER_ID, isActive: true }
    hoisted.rows.tournament = { id: TOURNAMENT_ID, tenantId: TENANT_ID, status: "registration" }
    hoisted.rows.team = { id: TEAM_ID, managerId: USER_ID, isActive: true }
    hoisted.rows.membership = { userId: USER_ID, tenantId: TENANT_ID, role: "member", status: "active", expiresAt: null }
    hoisted.rows.applicationById = undefined
    hoisted.appsQueue = []
    hoisted.calls.inserts = []
    hoisted.calls.updates = []
    hoisted.calls.audits = []
    authMock.mockResolvedValue({ userId: CLERK_ID } as never)
  })

  it("a team manager submits the first application: row + audit, no team mutations", async () => {
    const result = await submitTournamentApplication(TOURNAMENT_ID, TEAM_ID)
    expect(result).toEqual({ submitted: true, applicationId: APP_ID, status: "submitted", changed: true })
    expect(hoisted.calls.inserts).toEqual([
      { tenantId: TENANT_ID, tournamentId: TOURNAMENT_ID, teamId: TEAM_ID, submittedBy: USER_ID },
    ])
    expect(hoisted.calls.updates).toHaveLength(0)
    expect(hoisted.calls.audits[0]).toMatchObject({ actorId: USER_ID, tenantId: TENANT_ID, method: "TOURNAMENT_APPLICATION_SUBMITTED" })
  })

  it("resubmitting while 'submitted' is an identical replay: pure read", async () => {
    hoisted.appsQueue = [{ id: APP_ID, status: "submitted" }]
    const result = await submitTournamentApplication(TOURNAMENT_ID, TEAM_ID)
    expect(result).toEqual({ submitted: true, applicationId: APP_ID, status: "submitted", changed: false })
    expect(hoisted.calls.inserts).toHaveLength(0)
    expect(hoisted.calls.audits).toHaveLength(0)
  })

  it("needs_information states the honest answer path instead of letting a resubmit fake it", async () => {
    hoisted.appsQueue = [{ id: APP_ID, status: "needs_information" }]
    await expect(submitTournamentApplication(TOURNAMENT_ID, TEAM_ID)).rejects.toThrow(/Withdraw, then resubmit/)
    expect(hoisted.calls.inserts).toHaveLength(0)
  })

  it("waitlisted refuses (the owner decides from the list)", async () => {
    hoisted.appsQueue = [{ id: APP_ID, status: "waitlisted" }]
    await expect(submitTournamentApplication(TOURNAMENT_ID, TEAM_ID)).rejects.toThrow(/waitlisted/)
  })

  it("a historical approval refuses with the registration pointer", async () => {
    hoisted.appsQueue = [undefined, { id: APP_ID, status: "approved" }]
    await expect(submitTournamentApplication(TOURNAMENT_ID, TEAM_ID)).rejects.toThrow(/already approved for this tournament - register your squad/)
  })

  it("only the team's current manager may apply", async () => {
    hoisted.rows.team = { id: TEAM_ID, managerId: "other-manager", isActive: true }
    await expect(submitTournamentApplication(TOURNAMENT_ID, TEAM_ID)).rejects.toThrow(/team's manager/)
    expect(hoisted.calls.inserts).toHaveLength(0)
  })

  it("an ended tournament closes applications honestly", async () => {
    hoisted.rows.tournament = { id: TOURNAMENT_ID, tenantId: TENANT_ID, status: "completed" }
    await expect(submitTournamentApplication(TOURNAMENT_ID, TEAM_ID)).rejects.toThrow(/applications are closed/)
  })

  it("withdraw moves a live application with a leave time and NO decider (the member resolved it)", async () => {
    hoisted.rows.applicationById = { id: APP_ID, tenantId: TENANT_ID, teamId: TEAM_ID, status: "submitted" }
    const result = await withdrawTournamentApplication(APP_ID)
    expect(result).toEqual({ withdrawn: true, changed: true })
    const set = hoisted.calls.updates[0] as Record<string, unknown>
    expect(set.status).toBe("withdrawn")
    expect(set.decidedAt).toBeInstanceOf(Date)
    expect(set).not.toHaveProperty("decidedBy")
    expect(hoisted.calls.audits[0]).toMatchObject({ method: "TOURNAMENT_APPLICATION_WITHDRAWN" })
  })

  it("withdrawing a terminal application is a pure read", async () => {
    hoisted.rows.applicationById = { id: APP_ID, tenantId: TENANT_ID, teamId: TEAM_ID, status: "withdrawn" }
    const result = await withdrawTournamentApplication(APP_ID)
    expect(result).toEqual({ withdrawn: true, changed: false })
    expect(hoisted.calls.updates).toHaveLength(0)
    expect(hoisted.calls.audits).toHaveLength(0)
  })

  it("only the team's manager may withdraw", async () => {
    hoisted.rows.applicationById = { id: APP_ID, tenantId: TENANT_ID, teamId: TEAM_ID, status: "submitted" }
    hoisted.rows.team = { id: TEAM_ID, managerId: "other-manager", isActive: true }
    await expect(withdrawTournamentApplication(APP_ID)).rejects.toThrow(/team's manager/)
    expect(hoisted.calls.updates).toHaveLength(0)
  })

  it("the owner approves: provenance (decidedAt + decidedBy) and an owner-role audit", async () => {
    hoisted.rows.membership = { userId: USER_ID, tenantId: TENANT_ID, role: "league_owner", status: "active", expiresAt: null }
    hoisted.rows.applicationById = { id: APP_ID, tenantId: TENANT_ID, status: "submitted" }
    const result = await decideTournamentApplication(APP_ID, "approve")
    expect(result).toEqual({ decided: true, status: "approved", changed: true })
    const set = hoisted.calls.updates[0] as Record<string, unknown>
    expect(set.status).toBe("approved")
    expect(set.decidedAt).toBeInstanceOf(Date)
    expect(set.decidedBy).toBe(USER_ID)
    expect(hoisted.calls.audits[0]).toMatchObject({ actorRole: "league_owner", method: "TOURNAMENT_APPLICATION_APPROVE" })
  })

  it("a non-owner cannot decide (REG-03 review authority)", async () => {
    hoisted.rows.applicationById = { id: APP_ID, tenantId: TENANT_ID, status: "submitted" }
    await expect(decideTournamentApplication(APP_ID, "approve")).rejects.toThrow(/only the league owner/)
    expect(hoisted.calls.updates).toHaveLength(0)
  })

  it("an unknown decision word refuses before any transaction", async () => {
    await expect(decideTournamentApplication(APP_ID, "whatever")).rejects.toThrow(/Decision must be/)
    expect(hoisted.calls.audits).toHaveLength(0)
  })

  it("a decision replay on a terminal application is a pure read (history is not re-decided)", async () => {
    hoisted.rows.membership = { userId: USER_ID, tenantId: TENANT_ID, role: "league_owner", status: "active", expiresAt: null }
    hoisted.rows.applicationById = { id: APP_ID, tenantId: TENANT_ID, status: "declined" }
    const result = await decideTournamentApplication(APP_ID, "decline")
    expect(result).toEqual({ decided: true, status: "declined", changed: false })
    expect(hoisted.calls.updates).toHaveLength(0)
    expect(hoisted.calls.audits).toHaveLength(0)
  })

  it("the fake covers exactly the real tables (tournamentApplications, teams, tournaments all real)", () => {
    // Identity guard: the tables the writer touches are the REAL drizzle
    // objects, so a schema rename breaks this suite instead of faking.
    expect(tournamentApplications).toBeDefined()
    expect(teams).toBeDefined()
    expect(tournaments).toBeDefined()
  })
})
