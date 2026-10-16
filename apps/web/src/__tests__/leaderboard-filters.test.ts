import { describe, expect, it } from "vitest"
import { parsePublicLeaderboardSearch, publicLeaderboardFilters } from "@/lib/leaderboard-filters"

describe("Public leaderboard qualification filters", () => {
  it("defaults to no minimum without inventing an official qualification policy", () => {
    expect(parsePublicLeaderboardSearch({})).toMatchObject({ success: true, data: { minimumInnings: 0, minimumBalls: 0 } })
    expect(publicLeaderboardFilters.parse({})).toEqual({ minimumInnings: 0, minimumBalls: 0 })
  })

  it("parses bounded whole-number query values", () => {
    expect(parsePublicLeaderboardSearch({ minimumInnings: "3", minimumBalls: "60" })).toMatchObject({ success: true, data: { minimumInnings: 3, minimumBalls: 60 } })
    expect(parsePublicLeaderboardSearch({ minimumInnings: "10000", minimumBalls: "0" }).success).toBe(true)
  })

  it.each(["", "-1", "1.5", "1e2", "0x10", "NaN", "Infinity", "10001", "99999999999", " 3", "3 ", ["1", "2"]])(
    "rejects ambiguous or invalid qualification %s instead of broadening results", value => {
      expect(parsePublicLeaderboardSearch({ minimumInnings: value }).success).toBe(false)
      expect(parsePublicLeaderboardSearch({ minimumBalls: value }).success).toBe(false)
    })

  it("ignores unrelated query parameters without treating them as policy", () => {
    expect(parsePublicLeaderboardSearch({ format: "t20", minimumInnings: "2" })).toMatchObject({ success: true, data: { minimumInnings: 2, minimumBalls: 0 } })
  })
})
