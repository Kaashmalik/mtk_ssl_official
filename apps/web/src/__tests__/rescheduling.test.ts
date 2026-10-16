import { describe, expect, it } from "vitest"
import { DEFAULT_MIN_REST_HOURS, findSchedulingConflicts } from "@/lib/rescheduling"

const T = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`
const VENUE = "00000000-0000-4000-8000-000000000090"
const BASE = new Date("2026-11-01T15:00:00.000Z")
const at = (hours: number) => new Date(BASE.getTime() + hours * 3_600_000)

function reference(overrides: Record<string, unknown> = {}) {
  return {
    matchId: "f-1", teamAId: T(3), teamBId: T(4), venueId: null,
    scheduledDate: BASE, status: "scheduled", ...overrides,
  }
}

function check(fixtures: ReturnType<typeof reference>[], minRestHours?: number) {
  return findSchedulingConflicts({
    targetMatchId: "target", teamAId: T(1), teamBId: T(2), venueId: VENUE,
    proposedStart: BASE, fixtures, minRestHours,
  })
}

describe("rescheduling conflict and rest checks (rules v1)", () => {
  it("defaults to a four-hour rest window", () => {
    expect(DEFAULT_MIN_REST_HOURS).toBe(4)
  })

  it("blocks when either participant has a fixture inside the rest window", () => {
    const conflicts = check([
      reference({ matchId: "f-a", teamAId: T(1), teamBId: T(9) }), // 0h gap, team A
      reference({ matchId: "f-b", teamAId: T(7), teamBId: T(2), scheduledDate: at(3) }), // 3h gap, team B
    ])
    expect(conflicts).toHaveLength(2)
    expect(conflicts.every(c => c.reason === "team_rest")).toBe(true)
  })

  it("blocks venue reuse inside the window even for unrelated teams", () => {
    const conflicts = check([
      reference({ matchId: "f-venue", venueId: VENUE, scheduledDate: at(2) }),
    ])
    expect(conflicts).toEqual([{ conflictingMatchId: "f-venue", reason: "venue_in_use" }])
  })

  it("allows fixtures outside the rest window and elsewhere at the venue", () => {
    const conflicts = check([
      reference({ matchId: "f-far", scheduledDate: at(5) }),
      reference({ matchId: "f-venue-far", venueId: VENUE, scheduledDate: at(-5) }),
    ])
    expect(conflicts).toEqual([])
  })

  it("ignores the target fixture itself, cancelled fixtures and undated ones", () => {
    const conflicts = check([
      reference({ matchId: "target" }),
      reference({ matchId: "f-cancelled", teamAId: T(1), status: "cancelled" }),
      reference({ matchId: "f-undated", teamAId: T(1), scheduledDate: null }),
      reference({ matchId: "f-away-team", teamAId: T(6), teamBId: T(7), venueId: VENUE, scheduledDate: at(6) }),
    ])
    expect(conflicts).toEqual([])
  })

  it("honours a stricter custom rest window", () => {
    // 10 hours clear would pass the default; a 24-hour window blocks it.
    expect(check([reference({ scheduledDate: at(-10), teamAId: T(1) })])).toEqual([])
    expect(check([reference({ scheduledDate: at(-10), teamAId: T(1) })], 24))
      .toEqual([{ conflictingMatchId: "f-1", reason: "team_rest" }])
  })

  it("rejects negative thresholds", () => {
    expect(() => check([], -1)).toThrow("cannot be negative")
  })
})
