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
  minimumMatches: minimum,
  format: formatFilter,
  /**
   * Competition/season dimension (PUB-03): a published same-league tournament
   * id narrows every board to that competition's rows. Absent/empty means the
   * combined all-competition league view. The readers pin the value to a
   * PUBLISHED same-league tournament, so an arbitrary id simply yields no
   * rows — it can never widen the scope.
   */
  tournamentId: z.string().uuid().optional(),
}).strict()

export type PublicLeaderboardFilterInput = z.input<typeof publicLeaderboardFilters>
export type PublicLeaderboardFilters = z.output<typeof publicLeaderboardFilters>
export type PublicLeaderboardSearch = Record<string, string | string[] | undefined>

const tournamentIdFilter = z.string().uuid().optional()

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
/**
 * Minimum matches: the qualification basis for the fielding board, where
 * "innings" and "balls" have no recorded meaning (fielding scorecards are
 * one row per player per match). Batting/bowling boards do not use it.
 */
const searchFilters = z.object({
  minimumInnings: queryMinimum,
  minimumBalls: queryMinimum,
  minimumMatches: queryMinimum,
  format: queryFormat,
  // Same empty-string reset semantics as the format select.
  tournamentId: z.preprocess(
    value => (value === "" ? undefined : value),
    tournamentIdFilter,
  ),
}).pipe(publicLeaderboardFilters)

export function parsePublicLeaderboardSearch(input: PublicLeaderboardSearch) {
  return searchFilters.safeParse({ minimumInnings: input.minimumInnings, minimumBalls: input.minimumBalls, minimumMatches: input.minimumMatches, format: input.format, tournamentId: input.tournamentId })
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
