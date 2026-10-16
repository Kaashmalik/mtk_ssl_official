import { beforeEach, describe, expect, it, vi } from "vitest"
import { PgDialect } from "drizzle-orm/pg-core"
import { teams, matches } from "@mtk/database"
import { readMemberAssignments, memberAssignmentLimit } from "@/lib/member-assignments"

const mocks = vi.hoisted(() => ({ select: vi.fn() }))
vi.mock("@mtk/database", async original => ({ ...await original<typeof import("@mtk/database")>(), db: {
  select: mocks.select,
} }))

const A = "00000000-0000-4000-8000-000000000001"
const ALI = "00000000-0000-4000-8000-000000000002"
const BOB = "00000000-0000-4000-8000-000000000003"
const OTHER = "00000000-0000-4000-8000-000000000004"
const M1 = "00000000-0000-4000-8000-000000000005"
const dialect = new PgDialect()

let teamRows: unknown[] = []
let matchRows: unknown[] = []
const calls: { table: unknown; where: any; order: unknown; limit: number }[] = []

beforeEach(() => {
  vi.resetAllMocks()
  teamRows = []; matchRows = []; calls.length = 0
  mocks.select.mockImplementation(() => ({
    from: (table: unknown) => ({ where: (where: unknown) => ({ orderBy: (order: unknown) => ({ limit: async (limit: number) => {
      calls.push({ table, where, order, limit })
      return table === teams ? teamRows : matchRows
    } }) }) }),
  }))
})

describe("lib/member-assignments — exact-league assignment records", () => {
  it("scopes both assignment reads to the exact league and bounds them", async () => {
    teamRows = [{ id: OTHER, managerId: ALI, name: "Falcons" }]
    const map = await readMemberAssignments(A, [ALI, BOB])
    expect(calls).toHaveLength(2)
    const teamCall = calls.find(call => call.table === teams)!
    const matchCall = calls.find(call => call.table === matches)!
    expect(teamCall.limit).toBe(memberAssignmentLimit + 1)
    expect(matchCall.limit).toBe(memberAssignmentLimit + 1)
    expect(teamCall.order).toBe(teams.id)
    expect(matchCall.order).toBe(matches.id)
    expect(dialect.sqlToQuery(teamCall.where).params).toEqual([A, ALI, BOB])
    expect(dialect.sqlToQuery(matchCall.where).params).toEqual([A, ALI, BOB, ALI, BOB])
    expect(map[ALI].managedTeams).toEqual([{ id: OTHER, name: "Falcons" }])
    expect(map[BOB]).toEqual({ managedTeams: [], scoringMatches: [], isComplete: true })
  })

  it("records the primary and the backup scoring slot separately", async () => {
    const date = new Date("2026-10-20T09:00:00Z")
    matchRows = [{ id: M1, matchNumber: 7, status: "live", scheduledDate: date, scorerId: ALI, backupScorerId: BOB }]
    const map = await readMemberAssignments(A, [ALI, BOB])
    expect(map[ALI].scoringMatches).toEqual([{ id: M1, matchNumber: 7, status: "live", scheduledDate: date, role: "scorer" }])
    expect(map[BOB].scoringMatches).toEqual([{ id: M1, matchNumber: 7, status: "live", scheduledDate: date, role: "backup" }])
  })

  it("never double-counts a member who holds both scoring slots", async () => {
    matchRows = [{ id: M1, matchNumber: 7, status: "live", scheduledDate: null, scorerId: ALI, backupScorerId: ALI }]
    const map = await readMemberAssignments(A, [ALI])
    expect(map[ALI].scoringMatches).toHaveLength(1)
    expect(map[ALI].scoringMatches[0].role).toBe("scorer")
  })

  it("ignores assignments for accounts outside the loaded roster", async () => {
    teamRows = [{ managerId: OTHER, name: "Ghosts" }]
    matchRows = [{ id: M1, matchNumber: 7, status: "scheduled", scheduledDate: null, scorerId: OTHER, backupScorerId: null }]
    const map = await readMemberAssignments(A, [ALI])
    expect(map[ALI]).toEqual({ managedTeams: [], scoringMatches: [], isComplete: true })
    expect(map[OTHER]).toBeUndefined()
  })

  it("seeds every unique member", async () => {
    const map = await readMemberAssignments(A, [ALI, ALI])
    expect(Object.keys(map)).toEqual([ALI])
    expect(map[ALI]).toEqual({ managedTeams: [], scoringMatches: [], isComplete: true })
  })

  it("returns an empty map without querying when the league has no members", async () => {
    expect(await readMemberAssignments(A, [])).toEqual({})
    expect(mocks.select).not.toHaveBeenCalled()
  })

  it.each(["teams", "matches"])("discloses %s overflow for every loaded member and excludes the sentinel", async source => {
    if (source === "teams") {
      teamRows = Array.from({ length: memberAssignmentLimit + 1 }, (_, index) => ({ id: `team-${index}`, managerId: ALI, name: `Team ${index}` }))
    } else {
      matchRows = Array.from({ length: memberAssignmentLimit + 1 }, (_, index) => ({ id: `match-${index}`, matchNumber: index, status: "scheduled", scheduledDate: null, scorerId: ALI, backupScorerId: null }))
    }
    const map = await readMemberAssignments(A, [ALI, BOB])
    expect(map[ALI].isComplete).toBe(false)
    expect(map[BOB].isComplete).toBe(false)
    expect(source === "teams" ? map[ALI].managedTeams : map[ALI].scoringMatches).toHaveLength(memberAssignmentLimit)
  })

  it("does not claim truncation at exactly the limit", async () => {
    teamRows = Array.from({ length: memberAssignmentLimit }, (_, index) => ({ id: `team-${index}`, managerId: ALI, name: "Team" }))
    const map = await readMemberAssignments(A, [ALI])
    expect(map[ALI].isComplete).toBe(true)
  })

  it.each(["", "__proto__", "not-a-uuid"])("rejects invalid account id %s before reading", async id => {
    await expect(readMemberAssignments(A, [id])).rejects.toThrow()
    expect(mocks.select).not.toHaveBeenCalled()
  })

  it("rejects an invalid league before reading", async () => {
    await expect(readMemberAssignments("invalid", [ALI])).rejects.toThrow()
    expect(mocks.select).not.toHaveBeenCalled()
  })

  it("bounds the requested roster to 100 accounts", async () => {
    await expect(readMemberAssignments(A, Array(101).fill(ALI))).rejects.toThrow()
    expect(mocks.select).not.toHaveBeenCalled()
  })

  it("propagates a read failure rather than returning empty assignments", async () => {
    mocks.select.mockImplementation(() => { throw new Error("Database unavailable") })
    await expect(readMemberAssignments(A, [ALI])).rejects.toThrow("Database unavailable")
  })
})
