import { z } from "zod"

/** User-selected qualification, not a league award/official-record policy. */
export const PUBLIC_LEADERBOARD_MAX_MINIMUM = 10_000
const minimum = z.number().int().min(0).max(PUBLIC_LEADERBOARD_MAX_MINIMUM).default(0)

/**
 * Match-format dimension (PUB-03): values mirror the canonical `match_format`
 * enum on the matches table. Absent/undefined means the combined-format
 * season aggregates; a value switches to per-innings aggregation filtered on
 * the match's declared format. It is a display filter only - it does not make
 * anything a verified career record or an official award.
 */
export const PUBLIC_LEADERBOARD_FORMATS = ["t20", "odi", "test", "t10", "custom"] as const
export type PublicLeaderboardFormat = (typeof PUBLIC_LEADERBOARD_FORMATS)[number]
const formatFilter = z.enum(PUBLIC_LEADERBOARD_FORMATS).optional()

export const publicLeaderboardFilters = z.object({
  minimumInnings: minimum,
  minimumBalls: minimum,
  format: formatFilter,
}).strict()

export type PublicLeaderboardFilterInput = z.input<typeof publicLeaderboardFilters>
export type PublicLeaderboardFilters = z.output<typeof publicLeaderboardFilters>
export type PublicLeaderboardSearch = Record<string, string | string[] | undefined>

// Reject duplicate query parameters, fractions, negatives, exponent/hex notation,
// blank values, and unbounded thresholds rather than silently broadening results.
const queryMinimum = z.string().regex(/^\d{1,5}$/).default("0").transform(Number)
// An unselected format <select> submits the empty string: that RESETS to the
// combined view (a singleton only - repeated or unknown values still fail), so
// "Apply qualification" with the default option never turns into an error page.
const queryFormat = z.preprocess(
  value => (value === "" ? undefined : value),
  formatFilter,
)
const searchFilters = z.object({
  minimumInnings: queryMinimum,
  minimumBalls: queryMinimum,
  format: queryFormat,
}).pipe(publicLeaderboardFilters)

export function parsePublicLeaderboardSearch(input: PublicLeaderboardSearch) {
  return searchFilters.safeParse({ minimumInnings: input.minimumInnings, minimumBalls: input.minimumBalls, format: input.format })
}

/** Display label for a selected format filter; undefined keeps the combined label. */
export function publicLeaderboardFormatLabel(format: PublicLeaderboardFormat | undefined) {
  switch (format) {
    case "t20": return "T20"
    case "odi": return "ODI"
    case "test": return "Test"
    case "t10": return "T10"
    case "custom": return "Custom"
    default: return undefined
  }
}
