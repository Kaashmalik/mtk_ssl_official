import { beforeEach, describe, expect, it, vi } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import { auditLogs, matches } from "@mtk/database"
import { advanceKnockoutTournament } from "@/lib/tournament-advancement"

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  execute: vi.fn(),
  user: vi.fn(),
  league: vi.fn(),
  member: vi.fn(),
  tournament: vi.fn(),
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
}))

vi.mock("@mtk/database", async (original) => ({
  ...await original<typeof import("@mtk/database")>(),
  db: {
    transaction: mocks.transaction, execute: mocks.execute,
    query: { users: { findFirst: mocks.user }, tenants: { findFirst: mocks.league },
      userTenantRoles: { findFirst: mocks.member }, tournaments: { findFirst: mocks.tournament } },
    select: mocks.select, insert: mocks.insert, update: mocks.update,
  },
}))

const TENANT = "00000000-0000-4000-8000-000000000001"
const TOURNAMENT = "00000000-0000-4000-8000-000000000002"
const ACTOR = "00000000-0000-4000-8000-000000000003"
const T = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const dialect = new PgDialect()

const actor = { id: ACTOR, clerkId: "clerk_1", isActive: true }
const member = { userId: ACTOR, tenantId: TENANT, role: "league_owner", status: "active" }

const config8 = { version: 1, matchType: "t20", overs: 20, location: "Lahore", seedOrder: [1, 2, 3, 4, 5, 6, 7, 8], branding: {} } as const

const state: {
  tournament: Record<string, unknown>
  fixtures: { id: string; matchNumber: number; status: string; winnerId: string | null;
    teamAId: string; teamBId: string; matchType: string }[]
  fixtureCount: number
  auditValues: Record<string, any> | undefined
  updatedValues: Record<string, unknown> | undefined
} = { tournament: {}, fixtures: [], fixtureCount: 0, auditValues: undefined, updatedValues: undefined }

/** An 8-team knockout after its quarter-finals: 4 decided fixtures. */
const quarterFinalsDone = (): [string, string][] =>
  [[T(1), T(5)], [T(2), T(6)], [T(3), T(7)], [T(4), T(8)]]

const knockTournament = (overrides: Record<string, unknown> = {}) => ({
  id: TOURNAMENT, tenantId: TENANT, status: "live", format: "knockout",
  rules: { wizard: config8 }, ...overrides,
})

beforeEach(() => {
  vi.resetAllMocks()
  state.tournament = knockTournament()
  state.fixtureCount = 0
  state.auditValues = undefined
  state.updatedValues = undefined
  state.fixtures = quarterFinalsDone().map(([a, b], i) => ({
    id: `qf-${i + 1}`, matchNumber: i + 1, status: "completed",
    winnerId: a, teamAId: a, teamBId: b, matchType: "quarter_final",
  }))

  mocks.user.mockResolvedValue(actor)
  mocks.league.mockResolvedValue({ id: TENANT, isActive: true })
  mocks.member.mockResolvedValue(member)
  mocks.tournament.mockImplementation(async () => state.tournament)
  mocks.execute.mockResolvedValue([])

  mocks.select.mockReturnValue({
    from: () => ({
      where: () => ({
        orderBy: () => Promise.resolve(state.fixtures),
      }),
    }),
  })

  mocks.insert.mockImplementation((table: unknown) => ({
    values: (values: Record<string, unknown>) => {
      if (table === auditLogs) {
        state.auditValues = values
        return Promise.resolve([])
      }
      const row = { id: `match-${++state.fixtureCount}`, ...values }
      return { returning: () => Promise.resolve([row]) }
    },
  }))

  mocks.update.mockReturnValue({
    set: (set: Record<string, unknown>) => ({
      where: () => ({
        returning: () => {
          state.updatedValues = set
          return Promise.resolve([{ ...state.tournament, ...set }])
        },
      }),
    }),
  })

  mocks.transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn({
    execute: mocks.execute, select: mocks.select, insert: mocks.insert, update: mocks.update,
    query: {
      users: { findFirst: mocks.user }, tenants: { findFirst: mocks.league },
      userTenantRoles: { findFirst: mocks.member }, tournaments: { findFirst: mocks.tournament },
    },
  }))
})

const locks = () => mocks.execute.mock.calls.map(([query]) => dialect.sqlToQuery(query))

describe("advancement authority and gates", () => {
  it("locks account -> league/tournament before planning", async () => {
    await advanceKnockoutTournament("clerk_1", TENANT, TOURNAMENT)

    const all = locks()
    expect(all[0].sql).toContain("FOR UPDATE")
    expect(all[0].params).toEqual([ACTOR])
    expect(all[1].sql).toContain("FOR SHARE")
    expect(all[3].sql).toContain("FOR UPDATE") // tournament row
    expect(all[3].params).toEqual([TOURNAMENT, TENANT])
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "read committed" })
  })

  it("requires a live tournament with fixtures already generated", async () => {
    state.tournament = knockTournament({ status: "draft" })
    await expect(advanceKnockoutTournament("clerk_1", TENANT, TOURNAMENT))
      .rejects.toThrow("Generate fixtures before advancing")

    state.tournament = knockTournament({ status: "cancelled" })
    await expect(advanceKnockoutTournament("clerk_1", TENANT, TOURNAMENT))
      .rejects.toThrow("archived")
  })

  it("supports knockout format only for now", async () => {
    state.tournament = knockTournament({ format: "league" })
    await expect(advanceKnockoutTournament("clerk_1", TENANT, TOURNAMENT))
      .rejects.toThrow("knockout tournaments only")
  })

  it("is idempotent for completed tournaments (no writes)", async () => {
    state.tournament = knockTournament({ status: "completed" })
    const result = await advanceKnockoutTournament("clerk_1", TENANT, TOURNAMENT)
    expect(result.completed).toBeUndefined()
    expect(mocks.insert).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it("refuses to advance over undecided or no-result fixtures", async () => {
    state.fixtures[2].winnerId = null
    await expect(advanceKnockoutTournament("clerk_1", TENANT, TOURNAMENT))
      .rejects.toThrow("Fixture #3 is undecided")
    expect(mocks.insert).not.toHaveBeenCalled()

    state.fixtures[2].winnerId = T(3)
    state.fixtures[2].status = "no_result"
    await expect(advanceKnockoutTournament("clerk_1", TENANT, TOURNAMENT))
      .rejects.toThrow("has no result")
    expect(mocks.insert).not.toHaveBeenCalled()
  })
})

describe("advancing the knockout bracket", () => {
  it("creates the next stage from decided winners with continuing match numbers", async () => {
    const result = await advanceKnockoutTournament("clerk_1", TENANT, TOURNAMENT)

    expect(result.stage).toBe("Semi-finals")
    expect(result.created).toHaveLength(2)
    // Mirror pairing: QF1 winner v QF4 winner, QF2 v QF3.
    expect(result.created?.map(f => [f.teamAId, f.teamBId])).toEqual([
      [T(1), T(4)], [T(2), T(3)],
    ])
    expect(result.created?.map(f => f.matchNumber)).toEqual([5, 6])
    const createdRows = mocks.insert.mock.calls.filter(([table]) => table === matches)
    expect(createdRows).toHaveLength(2)
    expect(result.created?.every(f => f.matchType === "semi_final" && f.status === "scheduled"
      && f.totalOvers === 20 && f.createdBy === ACTOR)).toBe(true)

    const audit = state.auditValues
    expect(audit).toMatchObject({ method: "TOURNAMENT_ADVANCE", actorId: ACTOR, tenantId: TENANT })
    expect(audit?.payload).toMatchObject({ stage: "Semi-finals", created: 2 })
  })

  it("completes the tournament when the final is decided (claim-locked status transition)", async () => {
    state.fixtures = [
      ...quarterFinalsDone().map(([a, b], i) => ({
        id: `qf-${i + 1}`, matchNumber: i + 1, status: "completed", winnerId: a,
        teamAId: a, teamBId: b, matchType: "quarter_final",
      })),
      { id: "sf-1", matchNumber: 5, status: "completed", winnerId: T(1), teamAId: T(1), teamBId: T(2), matchType: "semi_final" },
      { id: "sf-2", matchNumber: 6, status: "completed", winnerId: T(2), teamAId: T(3), teamBId: T(4), matchType: "semi_final" },
      { id: "final", matchNumber: 7, status: "completed", winnerId: T(1), teamAId: T(1), teamBId: T(2), matchType: "final" },
    ]

    const result = await advanceKnockoutTournament("clerk_1", TENANT, TOURNAMENT)

    expect(result.completed).toBe(true)
    expect(result.stage).toBe("Final decided")
    expect(mocks.insert.mock.calls.filter(([table]) => table === matches)).toHaveLength(0)
    // FAN-03: the completion claim writes the final's winner as champion,
    // once, in the same transaction.
    expect(state.updatedValues).toMatchObject({ status: "completed", championTeamId: T(1) })
    expect(state.auditValues?.payload).toMatchObject({ stage: "Final decided",
      after: { status: "completed", championTeamId: T(1) } })
  })

  it("requires wizard configuration when creating a stage", async () => {
    state.tournament = knockTournament({ rules: null })
    await expect(advanceKnockoutTournament("clerk_1", TENANT, TOURNAMENT))
      .rejects.toThrow("Finish the tournament setup wizard")
  })
})
