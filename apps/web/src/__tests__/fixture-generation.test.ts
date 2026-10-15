import { beforeEach, describe, expect, it, vi } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import { auditLogs, leagueRegistrations, matches } from "@mtk/database"
import { generateTournamentFixtures } from "@/lib/fixture-generation"

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  execute: vi.fn(),
  user: vi.fn(),
  league: vi.fn(),
  member: vi.fn(),
  tournament: vi.fn(),
  match: vi.fn(),
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
}))

vi.mock("@mtk/database", async (original) => ({
  ...await original<typeof import("@mtk/database")>(),
  db: {
    transaction: mocks.transaction, execute: mocks.execute,
    query: { users: { findFirst: mocks.user }, tenants: { findFirst: mocks.league },
      userTenantRoles: { findFirst: mocks.member }, tournaments: { findFirst: mocks.tournament },
      matches: { findFirst: mocks.match } },
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

const config4 = { version: 1, matchType: "t20", overs: 20, location: "Lahore", seedOrder: [1, 2, 3, 4], branding: {} } as const
const config8 = { ...config4, seedOrder: [1, 2, 3, 4, 5, 6, 7, 8] } as const

function makeTournament(overrides: Record<string, unknown> = {}) {
  return {
    id: TOURNAMENT, tenantId: TENANT, status: "registration", format: "league",
    maxTeams: 8, rules: { wizard: config4 }, ...overrides,
  }
}

/** Registrations: T(1) approved first through T(8) last. */
const registrations8 = Array.from({ length: 8 }, (_, i) => ({
  teamId: T(i + 1), approvedAt: new Date(Date.UTC(2026, 0, i + 1)),
}))

const state: {
  tournament: Record<string, unknown>
  registrations: { teamId: string; approvedAt: Date }[]
  fixtureCount: number
  // Captured audit-log insert payload; `any` is scoped to assertions only.
  auditValues: Record<string, any> | undefined
} = {
  tournament: makeTournament(),
  registrations: registrations8.slice(0, 4),
  fixtureCount: 0,
  auditValues: undefined,
}

beforeEach(() => {
  vi.resetAllMocks()
  state.tournament = makeTournament()
  state.registrations = registrations8.slice(0, 4)
  state.fixtureCount = 0
  state.auditValues = undefined

  mocks.user.mockResolvedValue(actor)
  mocks.league.mockResolvedValue({ id: TENANT, isActive: true })
  mocks.member.mockResolvedValue(member)
  mocks.tournament.mockImplementation(async () => state.tournament)
  mocks.match.mockResolvedValue(undefined) // no existing fixtures
  mocks.execute.mockResolvedValue([])

  mocks.select.mockImplementation(() => ({
    from: (table: unknown) => ({
      where: () => table === leagueRegistrations
        ? Promise.resolve(state.registrations)
        : Promise.resolve(state.registrations.map(row => ({ id: row.teamId, isActive: true }))),
    }),
  }))

  mocks.insert.mockImplementation((table: unknown) => ({
    values: (values: Record<string, unknown>) => {
      if (table === auditLogs) {
        state.auditValues = values
        return Promise.resolve([])
      }
      const row = { id: `match-${++state.fixtureCount}`, ...values } // matches insert
      return { returning: () => Promise.resolve([row]) }
    },
  }))

  mocks.update.mockReturnValue({
    set: (set: Record<string, unknown>) => ({
      where: () => ({
        returning: () => Promise.resolve([{ ...state.tournament, ...set }]),
      }),
    }),
  })

  mocks.transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn({
    execute: mocks.execute,
    select: mocks.select,
    insert: mocks.insert,
    update: mocks.update,
    query: {
      users: { findFirst: mocks.user },
      tenants: { findFirst: mocks.league },
      userTenantRoles: { findFirst: mocks.member },
      tournaments: { findFirst: mocks.tournament },
      matches: { findFirst: mocks.match },
    },
  }))
})

const locks = () => mocks.execute.mock.calls.map(([query]) => dialect.sqlToQuery(query))
const unordered = (a: string, b: string) => [a, b].sort().join("|")
const auditEntry = () => state.auditValues

describe("fixture generation authority and locks", () => {
  it("locks account -> league/tournament before reading approvals and writing", async () => {
    await generateTournamentFixtures("clerk_1", TENANT, TOURNAMENT)

    const all = locks()
    expect(all[0].sql).toContain("FOR UPDATE")
    expect(all[0].params).toEqual([ACTOR])
    expect(all[1].sql).toContain("FOR SHARE")
    expect(all[1].params).toEqual([TENANT])
    expect(all[2].sql).toContain("FOR SHARE")
    expect(all[3].sql).toContain("FOR UPDATE") // tournament row
    expect(all[3].params).toEqual([TOURNAMENT, TENANT])
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "read committed" })
  })

  it("fails closed for archived tournaments without reading registrations", async () => {
    state.tournament = makeTournament({ status: "cancelled" })
    await expect(generateTournamentFixtures("clerk_1", TENANT, TOURNAMENT)).rejects.toThrow("archived")
  })

  it("refuses regeneration when any fixture already exists (no silent overwrite)", async () => {
    mocks.match.mockResolvedValue({ id: "existing" })
    await expect(generateTournamentFixtures("clerk_1", TENANT, TOURNAMENT))
      .rejects.toThrow("already generated")
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it("requires wizard configuration", async () => {
    state.tournament = makeTournament({ rules: null })
    await expect(generateTournamentFixtures("clerk_1", TENANT, TOURNAMENT))
      .rejects.toThrow("Finish the tournament setup wizard")
  })

  it("requires at least two approved teams and respects capacity", async () => {
    state.registrations = [registrations8[0]]
    await expect(generateTournamentFixtures("clerk_1", TENANT, TOURNAMENT))
      .rejects.toThrow("at least two approved teams")

    state.registrations = registrations8.slice(0, 5)
    state.tournament = makeTournament({ maxTeams: 3 })
    await expect(generateTournamentFixtures("clerk_1", TENANT, TOURNAMENT))
      .rejects.toThrow("capacity allows")
  })

  it("verifies every slotted team is an active league team", async () => {
    mocks.select.mockImplementation(() => ({
      from: (table: unknown) => ({
        where: () => table === leagueRegistrations
          ? Promise.resolve(state.registrations)
          : Promise.resolve(state.registrations.map(row => ({ id: row.teamId, isActive: row.teamId === T(1) }))),
      }),
    }))
    await expect(generateTournamentFixtures("clerk_1", TENANT, TOURNAMENT))
      .rejects.toThrow("no longer available")
    expect(mocks.insert).not.toHaveBeenCalled()
  })
})

describe("league fixture generation", () => {
  it("creates one scheduled match per round-robin pairing in approval order", async () => {
    const result = await generateTournamentFixtures("clerk_1", TENANT, TOURNAMENT)

    expect(result.rounds).toEqual(["Round 1", "Round 2", "Round 3"])
    expect(result.fixtures).toHaveLength(6)
    expect(mocks.insert.mock.calls.filter(([table]) => table === matches)).toHaveLength(6)

    // Slot 1 = first approved team, slot 4 = last; first pairing is 1 v 4.
    const first = result.fixtures[0]
    expect(unordered(first.teamAId, first.teamBId)).toBe(unordered(T(1), T(4)))
    expect(first).toMatchObject({ matchNumber: 1, matchType: "group", matchFormat: "t20",
      totalOvers: 20, status: "scheduled", tenantId: TENANT, tournamentId: TOURNAMENT, createdBy: ACTOR })
    expect(result.fixtures.map(f => f.matchNumber)).toEqual([1, 2, 3, 4, 5, 6])

    // Every team plays three matches across the structure.
    for (const team of [T(1), T(2), T(3), T(4)]) {
      expect(result.fixtures.filter(f => f.teamAId === team || f.teamBId === team)).toHaveLength(3)
    }

    // Competition starts: tournament goes live and registration closes.
    expect(mocks.update).toHaveBeenCalledOnce()
    expect(result.tournament).toMatchObject({ status: "live", registrationOpen: false })

    // Audited with before/after and counts.
    const audit = auditEntry()
    expect(audit).toMatchObject({ method: "TOURNAMENT_FIXTURES_GENERATE",
      actorId: ACTOR, actorRole: "league_owner", tenantId: TENANT })
    expect(audit?.payload).toMatchObject({ format: "league",
      after: { status: "live", matchCount: 6, registrationOpen: false } })
  })

  it("applies a saved valid seed order over approval ranking", async () => {
    state.tournament = makeTournament({ rules: { wizard: { ...config4, seedOrder: [4, 3, 2, 1] } } })
    const result = await generateTournamentFixtures("clerk_1", TENANT, TOURNAMENT)

    // Reverse layout: slot 1 holds the last-approved team.
    const first = result.fixtures[0]
    expect(unordered(first.teamAId, first.teamBId)).toBe(unordered(T(1), T(4)))
    expect(auditEntry()?.payload.savedSeedOrderApplied).toBe(true)
  })

  it("tolerates a stale saved seed order for group formats (falls back to ranking)", async () => {
    state.registrations = registrations8.slice(0, 5) // 5 approved vs a 4-slot order
    const result = await generateTournamentFixtures("clerk_1", TENANT, TOURNAMENT)
    expect(result.fixtures).toHaveLength(10)
    expect(auditEntry()?.payload.savedSeedOrderApplied).toBe(false)
  })

  it("leaves a live tournament's status untouched after generating", async () => {
    state.tournament = makeTournament({ status: "live" })
    const result = await generateTournamentFixtures("clerk_1", TENANT, TOURNAMENT)
    expect(mocks.update).not.toHaveBeenCalled()
    expect(result.tournament.status).toBe("live")
  })
})

describe("knockout fixture generation", () => {
  it("creates the first bracket round with standard seeding and stage label", async () => {
    state.tournament = makeTournament({ format: "knockout", rules: { wizard: config8 } })
    state.registrations = registrations8

    const result = await generateTournamentFixtures("clerk_1", TENANT, TOURNAMENT)

    expect(result.rounds).toEqual(["Quarter-finals"])
    expect(result.fixtures).toHaveLength(4)
    expect(result.fixtures.map(f => [f.teamAId, f.teamBId])).toEqual([
      [T(1), T(8)], [T(2), T(7)], [T(3), T(6)], [T(4), T(5)],
    ])
    expect(result.fixtures.every(f => f.matchType === "quarter_final")).toBe(true)
  })

  it("blocks non-power-of-two counts before any insert", async () => {
    state.tournament = makeTournament({ format: "knockout", rules: { wizard: config8 } })
    state.registrations = registrations8.slice(0, 6)
    await expect(generateTournamentFixtures("clerk_1", TENANT, TOURNAMENT))
      .rejects.toThrow("2, 4, 8, 16 or 32")
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it("requires the saved seed order to cover exactly the approved teams", async () => {
    state.tournament = makeTournament({ format: "knockout", rules: { wizard: config4 } })
    state.registrations = registrations8 // 8 approved vs a 4-slot saved order
    await expect(generateTournamentFixtures("clerk_1", TENANT, TOURNAMENT))
      .rejects.toThrow("re-save tournament seeding")
    expect(mocks.insert).not.toHaveBeenCalled()
  })
})

describe("hybrid fixture generation", () => {
  it("creates balanced group-stage fixtures only (knockout stage waits for standings)", async () => {
    state.tournament = makeTournament({ format: "hybrid" })
    state.registrations = registrations8.slice(0, 6)

    const result = await generateTournamentFixtures("clerk_1", TENANT, TOURNAMENT)

    expect(result.rounds).toEqual(["Group A", "Group B"])
    expect(result.fixtures).toHaveLength(6)
    expect(result.fixtures.every(f => f.matchType === "group")).toBe(true)
    // Group A's round-robin is complete: 3 matches among T(1), T(4), T(5).
    const groupA = [T(1), T(4), T(5)]
    expect(result.fixtures.filter(f => groupA.includes(f.teamAId) || groupA.includes(f.teamBId))).toHaveLength(3)
  })
})
