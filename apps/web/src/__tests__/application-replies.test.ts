import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * REG-03 (Batch 164): the threaded application-reply journey tests.
 * Table-keyed fake mirroring the B147 harness. Pinned: author_side is
 * server-derived (current team manager -> member, active league_owner ->
 * owner, everyone else refused); replies attach to LIVE applications only
 * (terminal = locked history); a reply NEVER mutates the application state
 * machine; bodies are normalized with a hard cap; the thread is bounded.
 */
const hoisted = vi.hoisted(() => {
  return {
    CLERK_ID: "clerk_reply_identity",
    TENANT_ID: "bb000000-1111-4a1e-9c1d-000000000001",
    USER_ID: "bb000000-2222-4a1e-9c1d-000000000002",
    MANAGER_ID: "bb000000-3333-4a1e-9c1d-000000000003",
    TEAM_ID: "bb000000-4444-4a1e-9c1d-000000000004",
    APP_ID: "bb000000-5555-4a1e-9c1d-000000000005",
    rows: {
      account: { id: "bb000000-2222-4a1e-9c1d-000000000002", isActive: true } as Record<string, unknown> | undefined,
      application: { id: "bb000000-5555-4a1e-9c1d-000000000005", tenantId: "bb000000-1111-4a1e-9c1d-000000000001", teamId: "bb000000-4444-4a1e-9c1d-000000000004", status: "needs_information" } as
        | Record<string, unknown>
        | undefined,
      team: { managerId: "bb000000-3333-4a1e-9c1d-000000000003" } as Record<string, unknown> | undefined,
      membership: { role: "member", status: "active", expiresAt: null } as Record<string, unknown> | undefined,
      replies: [] as Array<Record<string, unknown>>,
      replyCount: 0 as number,
    },
    calls: {
      inserts: [] as unknown[],
      audits: [] as unknown[],
    },
  }
})

vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

vi.mock("@mtk/database", async (importOriginal) => {
  const original = await importOriginal<typeof import("@mtk/database")>()
  const { users, teams, userTenantRoles, tournamentApplications, tournamentApplicationReplies, auditLogs } = original

  const takeFor = (table: unknown): Record<string, unknown>[] => {
    if (table === users) return hoisted.rows.account ? [hoisted.rows.account] : []
    if (table === teams) return hoisted.rows.team ? [hoisted.rows.team] : []
    if (table === userTenantRoles) return hoisted.rows.membership ? [hoisted.rows.membership] : []
    if (table === tournamentApplications) return hoisted.rows.application ? [hoisted.rows.application] : []
    if (table === tournamentApplicationReplies) return hoisted.rows.replies as Record<string, unknown>[]
    return []
  }

  // where() returns a THENABLE that also carries limit/orderBy - the
  // reply count query awaits .where() directly while the thread read
  // continues through orderBy().limit(). The COUNT projection (key
  // `total`) is served from replyCount; plain selects over the replies
  // table return the thread rows.
  const makeSelect = () =>
    vi.fn((projection?: Record<string, unknown>) => ({
      from: vi.fn((table: unknown) => {
        if (projection && "total" in projection && table === tournamentApplicationReplies) {
          const total = [{ total: hoisted.rows.replyCount }]
          return {
            where: vi.fn(() => ({
              then: (resolve: (v: unknown) => unknown) => Promise.resolve(total).then(resolve),
            })),
          }
        }
        const rows = takeFor(table)
        const thenable = {
          where: vi.fn(() => ({
            limit: vi.fn(async () => rows),
            orderBy: vi.fn(() => ({ limit: vi.fn(async () => rows) })),
            then: (resolve: (v: unknown) => unknown) => Promise.resolve(rows).then(resolve),
          })),
          orderBy: vi.fn(() => ({ limit: vi.fn(async () => rows) })),
          limit: vi.fn(async () => rows),
        }
        return thenable
      }),
    }))

  const makeTx = (): Record<string, unknown> => ({
    execute: vi.fn(async () => []),
    select: makeSelect(),
    insert: vi.fn((table: unknown) => ({
      values: vi.fn((values: unknown) => {
        if (table === auditLogs) hoisted.calls.audits.push(values)
        else hoisted.calls.inserts.push(values)
        return {
          returning: vi.fn(async () => [{ id: hoisted.APP_ID }]),
          then: (resolve: (v: unknown) => unknown) => Promise.resolve().then(() => resolve(undefined)),
        }
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({ where: vi.fn(async () => {}) })),
    })),
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

const { replyToTournamentApplication, readApplicationReplies } = await import("@/lib/tournament-applications")
const authMock = vi.mocked((await import("@clerk/nextjs/server")).auth)

const { APP_ID, CLERK_ID, MANAGER_ID, USER_ID } = hoisted

describe("REG-03 (Batch 164): the threaded application-reply journey", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hoisted.rows.account = { id: USER_ID, isActive: true }
    hoisted.rows.application = {
      id: APP_ID,
      tenantId: "bb000000-1111-4a1e-9c1d-000000000001",
      teamId: "bb000000-4444-4a1e-9c1d-000000000004",
      status: "needs_information",
    }
    hoisted.rows.team = { managerId: USER_ID }
    hoisted.rows.membership = { role: "member", status: "active", expiresAt: null }
    hoisted.rows.replies = []
    hoisted.rows.replyCount = 0
    hoisted.calls.inserts = []
    hoisted.calls.audits = []
    authMock.mockResolvedValue({ userId: CLERK_ID } as never)
  })

  it("the team's CURRENT manager replies as member: body normalized, audit with side", async () => {
    const result = await replyToTournamentApplication(APP_ID, "  Our\nsquad has two injuries.  ")
    expect(result).toEqual({ replied: true, side: "member", changed: true })
    expect(hoisted.calls.inserts).toHaveLength(1)
    expect(hoisted.calls.inserts[0]).toMatchObject({ applicationId: APP_ID, authorId: USER_ID, authorSide: "member", body: "Our squad has two injuries." })
    expect(hoisted.calls.audits[0]).toMatchObject({ method: "TOURNAMENT_APPLICATION_REPLIED", payload: { side: "member", status: "needs_information" } })
    // A reply NEVER mutates the application state machine.
    expect(hoisted.calls.audits).toHaveLength(1)
  })

  it("an active league owner replies as owner", async () => {
    hoisted.rows.team = { managerId: MANAGER_ID } // viewer is not the manager
    hoisted.rows.membership = { role: "league_owner", status: "active", expiresAt: null }
    const result = await replyToTournamentApplication(APP_ID, "Please send the final squad list.")
    expect(result).toEqual({ replied: true, side: "owner", changed: true })
    expect(hoisted.calls.inserts[0]).toMatchObject({ authorSide: "owner" })
  })

  it("everyone else is refused - authority is derived server-side", async () => {
    hoisted.rows.team = { managerId: MANAGER_ID } // viewer is not the manager
    hoisted.rows.membership = { role: "scorer", status: "active", expiresAt: null }
    await expect(replyToTournamentApplication(APP_ID, "hi")).rejects.toThrow(/manager or the league owner/)
    expect(hoisted.calls.inserts).toHaveLength(0)
  })

  it("a terminal application is locked history - no replies", async () => {
    hoisted.rows.application = {
      id: APP_ID,
      tenantId: "bb000000-1111-4a1e-9c1d-000000000001",
      teamId: "bb000000-4444-4a1e-9c1d-000000000004",
      status: "approved",
    }
    await expect(replyToTournamentApplication(APP_ID, "congrats")).rejects.toThrow(/locked/)
    expect(hoisted.calls.inserts).toHaveLength(0)
  })

  it("empty bodies refuse; whitespace-only is not a message", async () => {
    await expect(replyToTournamentApplication(APP_ID, "   ")).rejects.toThrow(/Write a message/)
    expect(hoisted.calls.inserts).toHaveLength(0)
  })

  it("the thread is bounded at 50 replies - a flood refuses", async () => {
    hoisted.rows.replyCount = 50
    await expect(replyToTournamentApplication(APP_ID, "one more")).rejects.toThrow(/limit of 50/)
    expect(hoisted.calls.inserts).toHaveLength(0)
  })

  it("the participant read returns the bounded thread; non-participants fail closed", async () => {
    hoisted.rows.replies = [{ id: "r1", authorSide: "owner", body: "Question", createdAt: new Date() }]
    const rows = await readApplicationReplies(APP_ID)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ authorSide: "owner", body: "Question" })

    hoisted.rows.team = { managerId: MANAGER_ID } // viewer is not the manager
    hoisted.rows.membership = { role: "fan", status: "active", expiresAt: null }
    await expect(readApplicationReplies(APP_ID)).rejects.toThrow(/manager or the league owner/)
  })
})
