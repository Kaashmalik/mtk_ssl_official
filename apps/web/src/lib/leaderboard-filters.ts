import { z } from "zod"

/** User-selected qualification, not a league award/official-record policy. */
export const PUBLIC_LEADERBOARD_MAX_MINIMUM = 10_000
const minimum = z.number().int().min(0).max(PUBLIC_LEADERBOARD_MAX_MINIMUM).default(0)
export const publicLeaderboardFilters = z.object({
  minimumInnings: minimum,
  minimumBalls: minimum,
}).strict()

export type PublicLeaderboardFilterInput = z.input<typeof publicLeaderboardFilters>
export type PublicLeaderboardFilters = z.output<typeof publicLeaderboardFilters>
export type PublicLeaderboardSearch = Record<string, string | string[] | undefined>

// Reject duplicate query parameters, fractions, negatives, exponent/hex notation,
// blank values, and unbounded thresholds rather than silently broadening results.
const queryMinimum = z.string().regex(/^\d{1,5}$/).default("0").transform(Number)
const searchFilters = z.object({
  minimumInnings: queryMinimum,
  minimumBalls: queryMinimum,
}).pipe(publicLeaderboardFilters)

export function parsePublicLeaderboardSearch(input: PublicLeaderboardSearch) {
  return searchFilters.safeParse({ minimumInnings: input.minimumInnings, minimumBalls: input.minimumBalls })
}
