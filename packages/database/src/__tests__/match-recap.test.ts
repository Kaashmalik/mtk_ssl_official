import { describe, expect, it } from "vitest"
import {
  RECAP_FIFTY_RUNS, RECAP_FIVE_WICKETS, RECAP_HUNDRED_RUNS, RECAP_THREE_WICKETS, RECAP_LABELS,
  deriveMatchRecap,
} from "../lib/match-recap"

/**
 * Match recap (FAN-03, Batch 133): pure derivation from official rows only.
 * Thresholds, bracket barring, order determinism and the fail-closed null
 * are pinned here because the public match page renders this verbatim.
 */

const baseInnings = {
  teamName: "Tigers",
  totalRuns: 165,
  totalWickets: 6,
  totalBalls: 120,
  batting: [{ name: "Abu", runs: 58, balls: 41 }],
  bowling: [{ name: "Bilal", wickets: 3, runs: 24, overs: 4.0 }],
}

describe("match recap derivation", () => {
  it("is fail-closed: no innings means no recap, never a fabricated summary", () => {
    expect(deriveMatchRecap({ resultText: "Tigers won", innings: [] })).toBeNull()
  })

  it("summarises scores, overs from official balls, and the recorded player of the match", () => {
    const recap = deriveMatchRecap({
      resultText: "Tigers won by 12 runs",
      manOfMatchName: "Abu",
      innings: [baseInnings, { ...baseInnings, teamName: "Falcons", totalRuns: 153, totalWickets: 0, totalBalls: 126 }],
    })
    expect(recap).not.toBeNull()
    expect(recap!.summary).toBe(
      "Tigers won by 12 runs. Scores: Tigers 165/6 (20.0 ov), Falcons 153 (21.0 ov). Abu was named player of the match.",
    )
  })

  it("honours the thresholds exactly - 49 is silent, 50 is a fifty, 99 a fifty, 100 a century", () => {
    expect(RECAP_FIFTY_RUNS).toBe(50)
    expect(RECAP_HUNDRED_RUNS).toBe(100)
    const at = (runs: number) => deriveMatchRecap({
      resultText: "x",
      innings: [{ ...baseInnings, batting: [{ name: "P", runs, balls: 30 }], bowling: [] }],
    })
    expect(at(49)!.moments).toHaveLength(0)
    expect(at(50)!.moments.map(m => m.kind)).toEqual(["fifty"])
    expect(at(99)!.moments.map(m => m.kind)).toEqual(["fifty"])
    expect(at(100)!.moments.map(m => m.kind)).toEqual(["hundred"]) // barred from also being a fifty
  })

  it("honours the wicket brackets - 2 silent, 3 a three-for, 5 a five-for, never doubled", () => {
    expect(RECAP_THREE_WICKETS).toBe(3)
    expect(RECAP_FIVE_WICKETS).toBe(5)
    const at = (wickets: number) => deriveMatchRecap({
      resultText: "x",
      innings: [{ ...baseInnings, batting: [], bowling: [{ name: "B", wickets, runs: 18, overs: 4.0 }] }],
    })
    expect(at(2)!.moments).toHaveLength(0)
    expect(at(3)!.moments.map(m => m.kind)).toEqual(["three_fors"])
    expect(at(5)!.moments.map(m => m.kind)).toEqual(["five_for"])
  })

  it("keeps deterministic order (input order breaks ties) and honest overs notation", () => {
    const recap = deriveMatchRecap({
      resultText: "x",
      innings: [{
        ...baseInnings,
        batting: [
          { name: "First", runs: 55, balls: 40 },
          { name: "Second", runs: 55, balls: 40 },
        ],
        bowling: [{ name: "Champ", wickets: 4, runs: 20, overs: 3.3 }],
      }],
    })
    // Equal metrics keep input order; the first is the "top" row.
    expect(recap!.topBatters.map(row => row.playerName)).toEqual(["First"])
    expect(recap!.moments.filter(m => m.kind === "fifty").map(m => m.playerName)).toEqual(["First", "Second"])
    expect(recap!.moments.filter(m => m.kind === "three_fors")[0].detail).toBe("4/20")
    // 3.3 overs notation = 21 balls = "3.3"; the bowler appears in topBowlers.
    expect(recap!.topBowlers[0]?.playerName).toBe("Champ")
    expect(recap!.topBowlers[0]?.overs).toBe("3.3")
  })

  it("carries verbatim labels and the derived-not-fabricated notice", () => {
    expect(RECAP_LABELS.title).toBe("Match Recap")
    expect(RECAP_LABELS.momentLabels.hundred).toBe("Century")
    expect(RECAP_LABELS.derivedNotice).toContain("never a fabricated narrative")
  })
})
