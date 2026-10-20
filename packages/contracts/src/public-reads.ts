/**
 * ENH-03-01: public/member projection contracts (PUB-06 allowlists on the
 * wire) plus the cursor pagination envelope.
 *
 * These mirror - field-for-field - the disclosed projections in
 * `apps/web/src/lib/public-visibility.ts`, but in portable wire form:
 * timestamps are ISO-8601 strings (the HTTP layer serializes Date to ISO),
 * enums are the shared status vocabulary, and nothing framework- or
 * database-specific appears. The native app consumes these as its canonical
 * read shapes (ENH-03-03 replaces its divergent local types with them).
 *
 * Widening any projection here is a deliberate, reviewed disclosure change -
 * never a side effect of a select. Pure TypeScript only; no dependencies
 * beyond the shared status vocabulary.
 */
import type {
  MatchFormat,
  MatchStatus,
  MatchType,
  StreamSource,
  StreamStatus,
  TossDecision,
  TournamentStatus,
} from "./status"

/** Monotonic contract version for the public projection set. */
export const PUBLIC_PROJECTION_VERSION = 1 as const

export type PublicTournament = {
  id: string
  name: string
  description: string | null
  format: MatchFormat
  status: TournamentStatus
  startDate: string | null
  endDate: string | null
  championTeamId: string | null
}

export type PublicMatch = {
  id: string
  tournamentId: string | null
  status: MatchStatus
  matchFormat: MatchFormat
  matchType: MatchType
  totalOvers: number | null
  scheduledDate: string | null
  venueId: string | null
  teamAId: string
  teamBId: string
  tossWinnerId: string | null
  tossDecision: TossDecision | null
  winnerId: string | null
  result: string | null
  manOfMatchId: string | null
  streamSource: StreamSource | null
  streamStatus: StreamStatus | null
  liveStreamUrl: string | null
}

export type PublicTeam = {
  id: string
  name: string
  shortName: string | null
  city: string | null
  logoUrl: string | null
  primaryColor: string | null
  secondaryColor: string | null
  homeGround: string | null
  foundedYear: number | null
}

export type PublicLeaderboardRow = {
  playerId: string
  playerName: string
  total: number
  playerVerified: boolean
}

export type PublicTournamentOption = {
  id: string
  name: string
}

export type PublicTournamentAward = {
  id: string
  category: string
  categoryLabel: string
  playerId: string | null
  playerName: string | null
  teamId: string | null
  teamName: string | null
  citation: string | null
  /** ISO-8601 on the wire (server-side Date). */
  declaredAt: string
}

export type PublicTournamentPrize = {
  id: string
  categoryName: string
  placement: string | null
  /** Null = a non-cash prize. Exact 2dp decimal string. */
  amount: string | null
  currency: string
  sponsor: string | null
}
