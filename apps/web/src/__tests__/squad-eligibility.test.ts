import { beforeEach, describe, expect, it, vi } from "vitest"
import { leagueRegistrations, matches } from "@mtk/database"
import { readMatchPlayersForScoring } from "@/lib/scoring-reads"
import { applySquadEligibility } from "@/lib/squad-eligibility"
import type { SquadRegistration } from "@mtk/database/lib/registered-squad-eligibility"
import { PgDialect } from "drizzle-orm/pg-core"
import type { SQL } from "drizzle-orm"

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  from: vi.fn(),
}))

vi.mock("@mtk/database", async (original) => ({
  ...await original<typeof import("@mtk/database")>(),
  db: { select: mocks.select },
  // The from-chain dispatcher is easier to assert through a passthrough spy.
}))

const TENANT = "00000000-0000-4000-8000-000000000001"
const TOURNAMENT = "00000000-0000-4000-8000-000000000002"
const MATCH = "00000000-0000-4000-8000-000000000003"
const T = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const dialect = new PgDialect()
const squad = (teamId: string, squadPlayerIds: string[] | null, status = "approved"): SquadRegistration => ({ tenantId: TENANT, tournamentId: TOURNAMENT, teamId, status, squadPlayerIds })

const playerRows = [
  { id: T(11), name: "Abid", role: "batsman" },
  { id: T(12), name: "Babar", role: "bowler" },
  { id: T(13), name: "Usman", role: "all_rounder" },
  { id: T(14), name: "Zafar", role: "keeper" },
]

const state: {
  match: Record<string, unknown> | null
  squads: SquadRegistration[]
  registrationQuery?: { where: SQL; limit: number }
  registrationFailure?: boolean
  fromTables: unknown[]
  playerReads: number
} = { match: null, squads: [], fromTables: [], playerReads: 0 }

beforeEach(() => {
  vi.resetAllMocks()
  state.match = { teamAId: T(1), teamBId: T(2), tournamentId: null }
  state.squads = []
  state.fromTables = []
  state.playerReads = 0
  state.registrationQuery = undefined
  state.registrationFailure = false

  mocks.select.mockImplementation(() => ({
    from: (table: unknown) => {
      state.fromTables.push(table)
      if (table === matches) {
        return { where: () => ({ limit: (async () => [state.match]) as unknown }) }
      }
      if (table === leagueRegistrations) {
        return { where: (where: SQL) => ({ orderBy: () => ({ limit: async (limit: number) => {
          state.registrationQuery = { where, limit }
          if (state.registrationFailure) throw new Error("Registration read unavailable")
          return state.squads
        } }) }) }
      }
      // players: the first read is team A (3 squad-highlighted rows), the
      // second team B (1 row) — mirroring the real team-scoped where.
      return {
        where: () => ({
          orderBy: () => {
            state.playerReads += 1
            return Promise.resolve(state.playerReads === 1
              ? [playerRows[0], playerRows[1], playerRows[3]]
              : [playerRows[2]])
          },
        }),
      }
    },
  }))
})

describe("squad eligibility (COMP-06, shared rule v2)", () => {
  it("applies declared squads: only registered squad players are selectable", async () => {
    state.match = { teamAId: T(1), teamBId: T(2), tournamentId: TOURNAMENT }
    state.squads = [
      squad(T(1), [T(11), T(12)]),
      squad(T(2), [T(13)]),
    ]

    const result = await readMatchPlayersForScoring(MATCH, TENANT)

    expect(result?.teamA.map(p => p.id)).toEqual([T(11), T(12)])
    expect(result?.teamB.map(p => p.id)).toEqual([T(13)])
  })

  it("keeps the full roster when the match is not part of a tournament", async () => {
    const result = await readMatchPlayersForScoring(MATCH, TENANT)
    expect(result?.teamA).toHaveLength(3) // 3 players map to team A
    expect(result?.teamB).toHaveLength(1)
    expect(state.fromTables).not.toContain(leagueRegistrations)
  })

  it("keeps the full roster for legacy squads (empty lists)", async () => {
    state.match = { teamAId: T(1), teamBId: T(2), tournamentId: TOURNAMENT }
    state.squads = [
      squad(T(1), []),
      squad(T(2), []),
    ]
    const result = await readMatchPlayersForScoring(MATCH, TENANT)
    expect(result?.teamA).toHaveLength(3)
    expect(result?.teamB).toHaveLength(1)
  })

  it("keeps the full roster when no registration exists for legacy sides", async () => {
    state.match = { teamAId: T(1), teamBId: T(2), tournamentId: TOURNAMENT }
    const result = await readMatchPlayersForScoring(MATCH, TENANT)
    expect(result?.teamA).toHaveLength(3)
    expect(result?.teamB).toHaveLength(1)
  })

  it("returns null for a match outside the league", async () => {
    state.match = null
    await expect(readMatchPlayersForScoring(MATCH, TENANT)).resolves.toBeNull()
  })
  it("does not treat a missing tournament column as an explicitly parentless friendly", async () => {
    state.match = { teamAId: T(1), teamBId: T(2) }
    await expect(readMatchPlayersForScoring(MATCH, TENANT)).rejects.toThrow("tournament context unavailable")
    expect(state.playerReads).toBe(0)
  })

  it.each(["pending", "withdrawn", "rejected", "waitlisted"])("does not restore a roster when an existing registration is %s", async status => {
    state.match = { teamAId: T(1), teamBId: T(2), tournamentId: TOURNAMENT }
    state.squads = [squad(T(1), [T(11)], status)]
    const result = await readMatchPlayersForScoring(MATCH, TENANT)
    expect(result?.teamA).toEqual([])
    expect(result?.teamB).toHaveLength(1)
  })

  it("reads registration state for both sides with an exact-league bound, not an approved-only filter", async () => {
    state.match = { teamAId: T(1), teamBId: T(2), tournamentId: TOURNAMENT }
    await readMatchPlayersForScoring(MATCH, TENANT)
    expect(state.registrationQuery?.limit).toBe(3)
    expect(dialect.sqlToQuery(state.registrationQuery!.where).params).toEqual([TENANT, TOURNAMENT, T(1), T(2)])
  })

  it.each([{ tenantId: T(5) }, { tournamentId: T(5) }, { teamId: T(5) }])("rejects a mis-scoped registration %s before player reads", async change => {
    state.match = { teamAId: T(1), teamBId: T(2), tournamentId: TOURNAMENT }
    state.squads = [{ ...squad(T(1), [T(11)]), ...change }]
    await expect(readMatchPlayersForScoring(MATCH, TENANT)).rejects.toThrow("require review")
    expect(state.playerReads).toBe(0)
  })

  it("fails closed on duplicate registrations", async () => {
    state.match = { teamAId: T(1), teamBId: T(2), tournamentId: TOURNAMENT }
    state.squads = [squad(T(1), [T(11)]), squad(T(1), [T(12)])]
    await expect(readMatchPlayersForScoring(MATCH, TENANT)).rejects.toThrow("require review")
  })

  it("propagates a registration outage instead of returning the full roster", async () => {
    state.match = { teamAId: T(1), teamBId: T(2), tournamentId: TOURNAMENT }
    state.registrationFailure = true
    await expect(readMatchPlayersForScoring(MATCH, TENANT)).rejects.toThrow("Registration read unavailable")
    expect(state.playerReads).toBe(0)
  })
})

describe("pure squad filter", () => {
  it("filters to declared squad ids, preserves order, and passes legacy/empty through", () => {
    const rows = [{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }]
    expect(applySquadEligibility(rows, ["c", "a"]).map(r => r.id)).toEqual(["a", "c"])
    expect(applySquadEligibility(rows, [])).toBe(rows)
    expect(applySquadEligibility(rows, null)).toBe(rows)
    expect(applySquadEligibility(rows, undefined)).toBe(rows)
  })
})
