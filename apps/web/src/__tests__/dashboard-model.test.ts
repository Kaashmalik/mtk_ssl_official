import { describe, expect, it } from "vitest"
import { getDashboardActions, getSetupSteps, toDashboardMatch, matchDashboardHref, formatDashboardDate,
  dashboardAssignmentLabel } from "@/lib/dashboard-model"
import { hasPermission, type UserRole } from "@/lib/rbac"

const match = { id: "match", tenantId: "tenant", teamAId: "a", teamBId: "b", scorerId: "actor",
  status: "live", scheduledDate: null, updatedAt: new Date(), result: null }
const names = new Map([["a", "Team A"], ["b", "Team B"]])
const innings = (teamId: string, inningsNumber: number, totalRuns: number, totalBalls = 6) =>
  ({ tenantId: "tenant", matchId: "match", teamId, inningsNumber, totalRuns, totalWickets: 2, totalBalls })

describe("Role-aware dashboard journeys", () => {
  it.each<UserRole>(["super_admin", "league_owner", "scorer", "team_manager", "coach", "player", "fan"])("shows only permitted actions for %s", (role) => {
    const actions = getDashboardActions(role)
    expect(actions.length).toBeGreaterThan(0)
    for (const action of actions) expect(hasPermission(role, action.permission)).toBe(true)
    if (!["super_admin", "league_owner"].includes(role)) {
      expect(actions.every((action) => !action.href.endsWith("/new"))).toBe(true)
    }
  })
  it("puts tournament creation first for organizers", () => {
    expect(getDashboardActions("league_owner")[0].href).toBe("/dashboard/tournaments/new")
    expect(getDashboardActions("league_owner")).toHaveLength(4)
  })
  it("guides scorers to their assignment list rather than unsupported creation", () => {
    expect(getDashboardActions("scorer")[0].description).toContain("assigned")
  })
  it("tracks actual record prerequisites without equating one team with match readiness", () => {
    expect(getSetupSteps({ teams: 1, players: 0, tournaments: 1, matches: 0 }).map((s) => s.done)).toEqual([true, false, false, false])
    expect(getSetupSteps({ teams: 2, players: 1, tournaments: 1, matches: 1 }).every((s) => s.done)).toBe(true)
    expect(getSetupSteps({ teams: 0, players: 0, tournaments: 0, matches: 0 }).every((s) => !s.done)).toBe(true)
  })
  it.each(["scheduled", "toss", "live", "innings_break"])("opens assigned %s matches in scoring", (status) => {
    expect(matchDashboardHref({ ...match, status }, "scorer", "actor")).toBe("/matches/match/scoring")
  })
  it.each<UserRole>(["fan", "player", "coach", "team_manager"])("does not show scoring access to %s even when assigned", (role) => {
    expect(matchDashboardHref(match, role, "actor")).toBe("/matches/match")
  })
  it.each(["completed", "abandoned", "cancelled", "no_result"])("uses read-only details for %s", (status) => {
    expect(matchDashboardHref({ ...match, status }, "league_owner", "actor")).toBe("/matches/match")
  })
  it("labels the member's assignment slot, including the COMP-06 umpire slots", () => {
    const slots = { scorerId: null, backupScorerId: null, umpire1Id: null, umpire2Id: null }
    expect(dashboardAssignmentLabel({ ...slots, scorerId: "actor" }, "actor")).toBe("Scorer")
    expect(dashboardAssignmentLabel({ ...slots, scorerId: "primary", backupScorerId: "actor" }, "actor")).toBe("Backup scorer")
    expect(dashboardAssignmentLabel({ ...slots, umpire1Id: "actor" }, "actor")).toBe("Officiating")
    expect(dashboardAssignmentLabel({ ...slots, umpire2Id: "actor" }, "actor")).toBe("Officiating")
    expect(dashboardAssignmentLabel({ ...slots, scorerId: "primary", umpire2Id: "actor" }, "actor")).toBe("Officiating")
    expect(dashboardAssignmentLabel(slots, "actor")).toBeNull()
  })
  it("carries the umpire slots through match summaries with honest nulls", () => {
    const withUmpire = toDashboardMatch({ ...match, scorerId: null, umpire1Id: "u1" }, names, [], "tenant")
    expect(withUmpire.umpire1Id).toBe("u1")
    expect(withUmpire.umpire2Id).toBeNull()
    expect(dashboardAssignmentLabel(withUmpire, "u1")).toBe("Officiating")
    const withoutUmpire = toDashboardMatch({ ...match, scorerId: null }, names, [], "tenant")
    expect(withoutUmpire.umpire1Id).toBeNull()
    expect(dashboardAssignmentLabel(withoutUmpire, "u1")).toBeNull()
  })
  it("requires exact database scorer identity but permits organizer oversight", () => {
    expect(matchDashboardHref(match, "scorer", "someone-else")).toBe("/matches/match")
    expect(matchDashboardHref({ ...match, scorerId: null }, "scorer", "actor")).toBe("/matches/match")
    expect(matchDashboardHref({ ...match, scorerId: null }, "league_owner", "actor")).toBe("/matches/match/scoring")
  })
})

describe("Accurate match summaries", () => {
  it("attaches scores to team IDs, not innings order, when Team B bats first", () => {
    const result = toDashboardMatch(match, names, [innings("b", 1, 120, 120), innings("a", 2, 60, 36)], "tenant")
    expect(result).toMatchObject({ teamA: "Team A", scoreA: "60/2 (6.0)", teamB: "Team B", scoreB: "120/2 (20.0)" })
  })
  it("does not invent a score or chase target when an innings has not begun", () => {
    const result = toDashboardMatch(match, names, [innings("b", 1, 10)], "tenant")
    expect(result.scoreA).toBe("Yet to bat")
    expect(result).not.toHaveProperty("target")
  })
  it("uses legal-ball notation rather than decimal over arithmetic", () => {
    expect(toDashboardMatch(match, names, [innings("a", 1, 10, 11)], "tenant").scoreA).toBe("10/2 (1.5)")
  })
  it("labels the latest innings when a super over exists", () => {
    expect(toDashboardMatch(match, names, [innings("a", 1, 100), innings("a", 3, 12)], "tenant").scoreA).toBe("12/2 (1.0) · Super over")
  })
  it.each(["scheduled", "toss", "live", "innings_break"])("links the assigned backup to scoring for %s", status => {
    expect(matchDashboardHref({ ...match, status, scorerId: "primary", backupScorerId: "actor" }, "scorer", "actor")).toBe("/matches/match/scoring")
  })
  it.each(["completed", "cancelled"])("does not offer backup scoring for ended status %s", status => {
    expect(matchDashboardHref({ ...match, status, backupScorerId: "actor" }, "scorer", "actor")).toBe("/matches/match")
  })
  it("a backup slot is not a role grant or platform scoring override", () => {
    for (const role of ["coach", "fan", "super_admin"] as const) {
      expect(matchDashboardHref({ ...match, scorerId: null, backupScorerId: "actor" }, role, "actor")).toBe("/matches/match")
    }
  })
  it("ignores foreign-tenant, other-match, or third-team innings", () => {
    expect(toDashboardMatch(match, names, [{ ...innings("a", 1, 999), tenantId: "foreign" },
      { ...innings("b", 2, 999), matchId: "other" }, innings("third", 1, 999)], "tenant").scoreA).toBe("Yet to bat")
  })
  it("uses unavailable labels rather than disclosing names from other resources", () => {
    expect(toDashboardMatch(match, new Map(), [], "tenant").teamA).toBe("Team unavailable")
  })
  it.each([null, new Date("invalid")])("handles missing or invalid scheduled times %s", (date) => {
    expect(formatDashboardDate(date)).toBe("Time to be confirmed")
  })
  it("shows an explicit UTC timezone independent of the server timezone", () => {
    expect(formatDashboardDate(new Date("2026-10-12T14:30:00+05:00"))).toContain("09:30 UTC")
  })
  it("keeps the UTC label when the display timezone is unset or unusable", () => {
    const date = new Date("2026-10-12T14:30:00Z")
    expect(formatDashboardDate(date, null)).toContain("14:30 UTC")
    expect(formatDashboardDate(date, undefined)).toContain("14:30 UTC")
    // Fail-closed: a bogus stored zone renders exactly like an unset one -
    // never an exception, never the server's zone imputed as the user's.
    expect(formatDashboardDate(date, "Mars/Olympus")).toBe(formatDashboardDate(date))
    expect(formatDashboardDate(date, "")).toBe(formatDashboardDate(date))
  })
  it("renders in the member's chosen timezone with its own short zone name", () => {
    const formatted = formatDashboardDate(new Date("2026-10-12T14:30:00Z"), "Asia/Karachi")
    // Karachi is UTC+5 in October (no DST): 19:30 local, labelled in Asia/Karachi.
    expect(formatted).toContain("19:30")
    expect(formatted).not.toContain("UTC")
  })
})
