import { describe, expect, it } from "vitest"
import type { PublicLeaderboardRow } from "../lib/public-visibility"

/**
 * Batch 124: "Most Runs / Most Wickets" on the public tournament page —
 * the SAME publication-gated, minor-consent-gated reads the leaderboards
 * page uses, scoped to this one competition. The builder admits only
 * complete rows, caps each list at five, ranks 1-based sequentially, and
 * emits NOTHING when both lists are empty (a tournament without published
 * stats shows no leaders card at all — never an empty shell).
 */

function row(overrides: Partial<PublicLeaderboardRow>, index = 0): PublicLeaderboardRow {
  return {
    playerId: `player-${index}`,
    playerName: `Player ${index}`,
    total: 100 - index,
    playerVerified: index % 2 === 0,
    ...overrides,
  }
}

describe("Tournament page stats leaders (Batch 124)", () => {
  it("ranks complete rows 1-based per list and caps each at five", async () => {
    const { buildTournamentLeaders, TOURNAMENT_LEADERS_LIMIT } = await import("../lib/tournament-leaders")
    const batting = Array.from({ length: 8 }, (_, i) => row({}, i))
    const data = buildTournamentLeaders({ batting, bowling: [row({ playerId: "bowler-1", playerName: "Bowler", total: 7, playerVerified: true })] })!
    expect(TOURNAMENT_LEADERS_LIMIT).toBe(5)
    expect(data.batting).toHaveLength(5)
    expect(data.batting.map(r => r.rank)).toEqual([1, 2, 3, 4, 5])
    expect(data.batting[0].playerName).toBe("Player 0")
    expect(data.bowling[0].total).toBe(7)
  })

  it("drops half-resolved rows — no name or a non-finite total is never displayed", async () => {
    const { buildTournamentLeaders } = await import("../lib/tournament-leaders")
    const data = buildTournamentLeaders({
      batting: [
        row({ playerName: "  " }, 0),
        row({ playerName: undefined as unknown as string }, 1),
        row({ total: Number.NaN }, 2),
        row({ total: undefined as unknown as number }, 3),
        row({}, 4),
      ],
      bowling: [],
    })!
    expect(data.batting.map(r => r.playerId)).toEqual(["player-4"])
  })

  it("both lists empty (or missing) → null: the page renders NO leaders card", async () => {
    const { buildTournamentLeaders } = await import("../lib/tournament-leaders")
    expect(buildTournamentLeaders({ batting: [], bowling: [] })).toBeNull()
    expect(buildTournamentLeaders({ batting: null, bowling: undefined })).toBeNull()
  })

  it("one non-empty list still yields a card; verified flags pass through unchanged", async () => {
    const { buildTournamentLeaders } = await import("../lib/tournament-leaders")
    const data = buildTournamentLeaders({ batting: [row({ playerVerified: true }, 0)], bowling: [] })!
    expect(data.batting[0].playerVerified).toBe(true)
    expect(data.bowling).toEqual([])
  })
})
