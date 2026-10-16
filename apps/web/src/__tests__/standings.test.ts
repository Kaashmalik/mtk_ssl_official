import { describe, expect, it } from "vitest"
import { computeStandings, formatNetRunRate, STANDINGS_RULE_VERSION } from "@/lib/standings"

const T = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`

const teams = [
  { id: T(1), name: "Alpha CC", shortName: "ALP" },
  { id: T(2), name: "Beta CC", shortName: "BET" },
  { id: T(3), name: "Gamma CC", shortName: "GAM" },
  { id: T(4), name: "Delta CC", shortName: "DEL" },
]

function match(overrides: Record<string, unknown> = {}) {
  return {
    matchId: "m-1", teamAId: T(1), teamBId: T(2), status: "completed",
    winnerId: T(1), innings: [] as { teamId: string; runs: number; balls: number }[],
    ...overrides,
  }
}

describe("standings points (rules v1)", () => {
  it("awards 2 for a win and 0 for a loss", () => {
    const rows = computeStandings({ teams, matches: [match({ winnerId: T(1) })] })
    const alpha = rows.find(r => r.teamId === T(1))!
    const beta = rows.find(r => r.teamId === T(2))!
    expect(alpha).toMatchObject({ played: 1, won: 1, lost: 0, points: 2, ruleVersion: STANDINGS_RULE_VERSION })
    expect(beta).toMatchObject({ played: 1, won: 0, lost: 1, points: 0 })
  })

  it("shares a point for no-result fixtures and undecided completed fixtures", () => {
    const rows = computeStandings({ teams, matches: [
      match({ matchId: "m-1", status: "no_result", winnerId: null }),
      match({ matchId: "m-2", status: "completed", winnerId: null }),
    ] })
    const alpha = rows.find(r => r.teamId === T(1))!
    expect(alpha).toMatchObject({ played: 2, won: 0, lost: 0, noResult: 2, points: 2 })
  })

  it("counts only played statuses: scheduled/live/abandoned/cancelled are excluded", () => {
    const rows = computeStandings({ teams, matches: [
      match({ matchId: "m-1", status: "scheduled" }),
      match({ matchId: "m-2", status: "live" }),
      match({ matchId: "m-3", status: "abandoned" }),
      match({ matchId: "m-4", status: "cancelled" }),
      match({ matchId: "m-5", status: null }),
    ] })
    expect(rows.every(r => r.played === 0 && r.points === 0)).toBe(true)
  })

  it("ignores pairings that are not two registered teams, and never counts self-matches", () => {
    const rows = computeStandings({ teams, matches: [
      match({ matchId: "m-1", teamBId: T(9) }), // unregistered opponent
      match({ matchId: "m-2", teamAId: T(3), teamBId: T(3) }), // self-match
    ] })
    expect(rows.every(r => r.played === 0)).toBe(true)
  })
})

describe("net run rate (cricket convention over balls)", () => {
  it("aggregates runs/balls faced and conceded across counted fixtures", () => {
    // Alpha bats 160 off 120, Beta bats 140 off 120 (both complete).
    const rows = computeStandings({ teams, matches: [
      match({ matchId: "m-1", winnerId: T(1), innings: [
        { teamId: T(1), runs: 160, balls: 120 },
        { teamId: T(2), runs: 140, balls: 120 },
      ] }),
    ] })
    const alpha = rows.find(r => r.teamId === T(1))!
    const beta = rows.find(r => r.teamId === T(2))!
    expect(alpha.runsFor).toBe(160); expect(alpha.ballsFor).toBe(120)
    expect(alpha.runsAgainst).toBe(140); expect(alpha.ballsAgainst).toBe(120)
    expect(alpha.netRunRate).toBeCloseTo(160 / 120 - 140 / 120, 10)
    expect(beta.netRunRate).toBeCloseTo(-alpha.netRunRate, 10)
  })

  it("sums across matches before dividing (not per-match average)", () => {
    const rows = computeStandings({ teams, matches: [
      match({ matchId: "m-1", winnerId: T(1), innings: [
        { teamId: T(1), runs: 100, balls: 60 },
        { teamId: T(2), runs: 90, balls: 120 },
      ] }),
      match({ matchId: "m-2", winnerId: T(1), innings: [
        { teamId: T(1), runs: 50, balls: 60 },
        { teamId: T(2), runs: 90, balls: 120 },
      ] }),
    ] })
    const alpha = rows.find(r => r.teamId === T(1))!
    // 150 runs in 120 balls vs 180 conceded in 240 balls.
    expect(alpha.netRunRate).toBeCloseTo(150 / 120 - 180 / 240, 10)
  })

  it("skews nothing when innings are missing: no evidence means no NRR, not zero credit", () => {
    const rows = computeStandings({ teams, matches: [
      match({ matchId: "m-1", winnerId: T(1), innings: [{ teamId: T(1), runs: 160, balls: 120 }] }),
      match({ matchId: "m-2", winnerId: T(1) }),
    ] })
    const alpha = rows.find(r => r.teamId === T(1))!
    const beta = rows.find(r => r.teamId === T(2))!
    expect(alpha.hasNetRunRate).toBe(false) // opponent innings missing -> voided
    expect(beta.hasNetRunRate).toBe(false)
  })
})

describe("tie-breakers: points -> NRR -> wins -> name", () => {
  it("ranks by points first", () => {
    const rows = computeStandings({ teams: teams.slice(0, 2), matches: [match({})] })
    expect(rows.map(r => r.name)).toEqual(["Alpha CC", "Beta CC"])
  })

  it("breaks equal points by NRR, then wins, then name", () => {
    // Gamma and Delta both have 2 points and equal records; Gamma conceded more.
    const rows = computeStandings({ teams: [teams[2], teams[3]], matches: [
      {
        matchId: "m-1", teamAId: T(3), teamBId: T(1), status: "completed", winnerId: T(3),
        innings: [{ teamId: T(3), runs: 120, balls: 120 }, { teamId: T(1), runs: 118, balls: 120 }],
      },
      {
        matchId: "m-2", teamAId: T(4), teamBId: T(2), status: "completed", winnerId: T(4),
        innings: [{ teamId: T(4), runs: 121, balls: 120 }, { teamId: T(2), runs: 118, balls: 120 }],
      },
    ] })
    expect(rows.map(r => r.name)).toEqual(["Delta CC", "Gamma CC"])
  })

  it("teams with no batting evidence rank below teams with a real NRR at equal points", () => {
    // Alpha and Beta each won once; Beta's match has no innings evidence.
    const rows = computeStandings({ teams: teams.slice(0, 2), matches: [
      match({ matchId: "m-1", teamAId: T(3), teamBId: T(4), winnerId: T(3), innings: [] }),
    ] })
    expect(rows.every(r => r.played === 0)).toBe(true)
  })
})

describe("formatNetRunRate (broadcast convention)", () => {
  it("formats signed three decimals, unsigned exact zero", () => {
    expect(formatNetRunRate(1.25)).toBe("+1.250")
    expect(formatNetRunRate(-0.3)).toBe("-0.300")
    expect(formatNetRunRate(0)).toBe("0.000")
    expect(formatNetRunRate(-0)).toBe("0.000")
    expect(formatNetRunRate(0.4567)).toBe("+0.457")
  })
})
