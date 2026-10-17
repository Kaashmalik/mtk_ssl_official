import { describe, expect, it } from "vitest"
import { parsePublicLeaderboardSearch, publicLeaderboardFilters, PUBLIC_LEADERBOARD_FORMATS } from "@/lib/leaderboard-filters"

describe("Public leaderboard qualification filters", () => {
  it("defaults to no minimum without inventing an official qualification policy", () => {
    expect(parsePublicLeaderboardSearch({})).toMatchObject({ success: true, data: { minimumInnings: 0, minimumBalls: 0, minimumMatches: 0 } })
    expect(publicLeaderboardFilters.parse({})).toEqual({ minimumInnings: 0, minimumBalls: 0, minimumMatches: 0 })
  })

  it("parses bounded whole-number query values", () => {
    expect(parsePublicLeaderboardSearch({ minimumInnings: "3", minimumBalls: "60" })).toMatchObject({ success: true, data: { minimumInnings: 3, minimumBalls: 60 } })
    expect(parsePublicLeaderboardSearch({ minimumInnings: "10000", minimumBalls: "0" }).success).toBe(true)
  })

  it.each(["", "-1", "1.5", "1e2", "0x10", "NaN", "Infinity", "10001", "99999999999", " 3", "3 ", ["1", "2"]])(
    "rejects ambiguous or invalid qualification %s instead of broadening results", value => {
      expect(parsePublicLeaderboardSearch({ minimumInnings: value }).success).toBe(false)
      expect(parsePublicLeaderboardSearch({ minimumBalls: value }).success).toBe(false)
      // Fielding qualification (matches) holds the same strictness.
      expect(parsePublicLeaderboardSearch({ minimumMatches: value }).success).toBe(false)
    })

  it("parses the fielding board's matches qualification on the same bounds", () => {
    expect(parsePublicLeaderboardSearch({ minimumMatches: "5" })).toMatchObject({ success: true, data: { minimumMatches: 5 } })
    expect(parsePublicLeaderboardSearch({ minimumMatches: "10000" }).success).toBe(true)
  })

  it("ignores unrelated query parameters without treating them as policy", () => {
    expect(parsePublicLeaderboardSearch({ minimumInnings: "2" })).toMatchObject({ success: true, data: { minimumInnings: 2, minimumBalls: 0 } })
  })

  it("defaults to no format filter (combined season aggregates)", () => {
    expect(parsePublicLeaderboardSearch({})).toMatchObject({ success: true, data: { format: undefined } })
    expect(publicLeaderboardFilters.parse({})).toEqual({ minimumInnings: 0, minimumBalls: 0, minimumMatches: 0, format: undefined })
  })

  it.each(PUBLIC_LEADERBOARD_FORMATS)("parses the canonical match format %s", format => {
    expect(parsePublicLeaderboardSearch({ format })).toMatchObject({ success: true, data: { format } })
  })

  it("an empty-string format resets to the combined view instead of erroring", () => {
    // The unselected <select> option submits "" - it must not brick the form.
    expect(parsePublicLeaderboardSearch({ format: "" })).toMatchObject({ success: true, data: { format: undefined } })
    // The reader tier stays strict: callers cannot pass "" through directly.
    expect(publicLeaderboardFilters.safeParse({ minimumInnings: 0, minimumBalls: 0, format: "" }).success).toBe(false)
  })

  it.each(["T20", "t20 ", "twenty20", "ODI", ["t20", "odi"], "t20;drop"])(
    "rejects an invalid or repeated format %s instead of broadening results", value => {
      expect(parsePublicLeaderboardSearch({ format: value as never }).success).toBe(false)
      expect(publicLeaderboardFilters.safeParse({ minimumInnings: 0, minimumBalls: 0, format: value }).success).toBe(false)
    })
})
