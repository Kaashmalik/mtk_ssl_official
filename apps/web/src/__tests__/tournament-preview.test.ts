import { describe, expect, it } from "vitest"
import { tournamentLogoFileError } from "@/lib/tournament-logo"
import { estimateTournamentSchedule } from "@/lib/tournament-schedule-preview"

describe("Tournament schedule estimates", () => {
  it.each([
    { format: "knockout" as const, teams: 8, total: 7 },
    { format: "league" as const, teams: 8, total: 28 },
    { format: "hybrid" as const, teams: 5, total: 5 },
    { format: "hybrid" as const, teams: 8, total: 13 },
  ])("estimates $format for $teams slots", ({ format, teams, total }) => {
    expect(estimateTournamentSchedule(format, teams).total).toBe(total)
  })
  it("counts a single-day schedule as one day, not seven", () => {
    expect(estimateTournamentSchedule("knockout", 4, "2026-11-01", "2026-11-01")).toEqual({ total: 3, days: 1, matchesPerDay: 3 })
  })
  it("includes both start and end dates in the duration", () => {
    expect(estimateTournamentSchedule("knockout", 8, "2026-11-01", "2026-11-03")).toEqual({ total: 7, days: 3, matchesPerDay: 3 })
  })
  it("does not invent dates when the draft is unscheduled or the range is invalid", () => {
    expect(estimateTournamentSchedule("league", 4)).toMatchObject({ days: null, matchesPerDay: null })
    expect(estimateTournamentSchedule("league", 4, "2026-11-03", "2026-11-01")).toMatchObject({ days: null, matchesPerDay: null })
  })
})

describe("Logo upload preflight", () => {
  it("permits supported raster formats up to the byte limit", () => {
    expect(tournamentLogoFileError({ type: "image/png", size: 128 * 1024 })).toBeNull()
  })
  it.each([{ type: "image/svg+xml", size: 10 }, { type: "text/html", size: 10 },
    { type: "image/png", size: 128 * 1024 + 1 }, { type: "image/png", size: 0 }])("rejects unsuitable uploads %s", (file) => {
    expect(tournamentLogoFileError(file)).not.toBeNull()
  })
})
