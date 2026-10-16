/** Existing lifecycle publication policy, shared by web and live-read services. */
export const PUBLISHED_TOURNAMENT_STATUS_VALUES = ["registration", "live", "completed"] as const
export const PUBLISHED_MATCH_STATUS_VALUES = ["scheduled", "toss", "live", "innings_break", "completed", "abandoned", "no_result"] as const
const tournaments: ReadonlySet<string> = new Set(PUBLISHED_TOURNAMENT_STATUS_VALUES)
const matches: ReadonlySet<string> = new Set(PUBLISHED_MATCH_STATUS_VALUES)
export function isTournamentPublished(status: string | null | undefined): boolean { return !!status && tournaments.has(status) }
export function isMatchPublished(status: string | null | undefined): boolean { return !!status && matches.has(status) }
