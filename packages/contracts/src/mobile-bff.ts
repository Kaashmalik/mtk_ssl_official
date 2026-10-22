/**
 * ENH-03-03: THE mobile BFF convention, documented in code.
 *
 * Every native read goes through the authenticated web BFF (NextApp routes
 * under `/api/mobile/*`, Clerk bearer in the `Authorization` header). The
 * route resolves tenant and actor authority SERVER-SIDE from the session -
 * transport never grants authority, the device never sends a tenant id it
 * "believes" in, and switching leagues on the web instantly switches what
 * the native app can see (no cached tenant id to go stale).
 *
 * Three rules, enforced by this module's types:
 *
 * 1. PROJECTIONS ONLY. Responses carry the shared wire projections
 *    (`PublicMatch`, `MemberMatch`, ...), never raw database rows: the
 *    status vocabulary is the complete 10-value `MatchStatus` union (the
 *    native `Match` type previously missed `forfeited`/`postponed`), and
 *    widening a projection is a reviewed decision made HERE, never a side
 *    effect of a `select("*")`.
 *
 * 2. CURSOR PAGINATION. Every list response is a `MobileBffListResponse`:
 *    `{ items, nextCursor }` with an opaque versioned cursor
 *    (`pagination.ts`). No hard `limit(50)` caps that silently truncate a
 *    60-fixture league; clients page until `nextCursor` is null.
 *
 * 3. ONE ROUTE MAP. `MOBILE_BFF_ROUTES` is the single place route paths
 *    exist as strings - screens import the map instead of inlining URLs,
 *    so renaming a route is a compile error away from every caller.
 */
import type {
  AnnouncementPriority,
  AnnouncementType,
  BattingStyle,
  BowlingStyle,
  PlayerRole,
} from "./status"
import type { PublicMatch, PublicTeam } from "./public-reads"
import type { BroadcastPlaybackState } from "./broadcast-playback"

/** Monotonic convention version for the mobile BFF surface. */
export const MOBILE_BFF_VERSION = 1 as const

/** The authenticated native BFF route map (paths relative to the web origin). */
export const MOBILE_BFF_ROUTES = {
  /** GET the signed-in member's match list (cursor paginated). */
  matches: "/api/mobile/matches",
  /** GET the league's teams (cursor paginated; teamId= for a single team). */
  teams: "/api/mobile/teams",
  /** GET the league's players (teamId= roster filter; playerId= single + season stats). */
  players: "/api/mobile/players",
  /** GET platform announcements (PUBLIC - works signed-out, audience-gated). */
  announcements: "/api/mobile/announcements",
  /** POST one recorded delivery (SCORE-08/09 intake). */
  scoringBall: "/api/mobile/scoring/ball",
  /** GET the scoring session hydration for a match. */
  scoringState: "/api/mobile/scoring/state",
  /** POST push-token registration. */
  pushRegister: "/api/mobile/push/register",
} as const

/** The canonical envelope of every paginated mobile BFF list response. */
export type MobileBffListResponse<T> = {
  items: T[]
  /** Opaque cursor for the next page, or null when the list is exhausted. */
  nextCursor: string | null
}

/**
 * The member match projection on the native BFF wire: the public projection
 * PLUS the team names a signed-in member of the league is entitled to see
 * alongside the match (public pages resolve names per-disclosure rules;
 * the member's own league shows them for every match, any status).
 */
export type MemberMatch = PublicMatch & {
  teamAName: string
  teamBName: string
  /**
   * ENH-08-03: present on the single-match read only. The list page does not
   * pay for a per-row broadcast lookup; the detail screen needs the truthful
   * Live/Replay state to label its watch button.
   */
  playback?: {
    state: BroadcastPlaybackState
    hasReplay: boolean
  }
}

/** Hard ceiling on a mobile BFF page (requests may ask for less, never more). */
export const MOBILE_BFF_MAX_PAGE_SIZE = 50 as const

/** Default page size when the client does not ask for a specific one. */
export const MOBILE_BFF_DEFAULT_PAGE_SIZE = 25 as const

/**
 * The member team projection = the public team disclosure (PUB-06), which is
 * already the exact shape the native teams surface consumes.
 */
export type MemberTeam = PublicTeam

/** Plain-view player projection for the native rosters and directories. */
export type MemberPlayer = {
  id: string
  name: string
  teamId: string | null
  teamName: string | null
  jerseyNumber: number | null
  role: PlayerRole | null
  battingStyle: BattingStyle | null
  bowlingStyle: BowlingStyle | null
  /** Embedded on the single read (`?playerId=`); absent on list pages. */
  seasonStats?: MemberPlayerSeasonStats[]
}

/**
 * Per-tournament season aggregate, numbers as the database stores them:
 * integer counts verbatim, decimals as exact 2dp/1dp strings so no client
 * re-derives (or re-rounds) them differently.
 */
export type MemberPlayerSeasonStats = {
  tournamentId: string
  matchesPlayed: number
  runsScored: number
  ballsFaced: number
  inningsBatted: number
  notOuts: number
  fours: number
  sixes: number
  highestScore: number
  isHighestScoreNotOut: boolean
  fifties: number
  hundreds: number
  ducks: number
  battingAverage: string | null
  strikeRate: string | null
  wicketsTaken: number
  oversBowled: string | null
  ballsBowled: number
  runsConceded: number
  inningsBowled: number
  maidens: number
  bowlingAverage: string | null
  economyRate: string | null
  bowlingStrikeRate: string | null
  bestBowlingWickets: number
  bestBowlingRuns: number
  fourWicketHauls: number
  fiveWicketHauls: number
  catches: number
  runOuts: number
  stumpings: number
}

/** Platform announcement on the native wire (summary = the message body). */
export type AnnouncementItem = {
  id: string
  title: string
  summary: string
  publishedAt: string
  type: AnnouncementType
  priority: AnnouncementPriority
  actionUrl: string | null
  actionText: string | null
}

/**
 * The keyset tuple encoded INSIDE the cursor envelope's `after` string:
 * `<createdAt ISO>~<match id>`. The list orders by `(createdAt DESC, id DESC)`,
 * so the tuple is the opaque keyset marker - clients must treat it as opaque.
 */
export function encodeMemberMatchKeyset(createdAtIso: string, matchId: string): string {
  return `${createdAtIso}~${matchId}`
}

/** Inverse of `encodeMemberMatchKeyset`; undefined when the marker is malformed. */
export function decodeMemberMatchKeyset(after: string): { createdAtIso: string; matchId: string } | undefined {
  const sep = after.lastIndexOf("~")
  if (sep <= 0 || sep === after.length - 1) return undefined
  const createdAtIso = after.slice(0, sep)
  const matchId = after.slice(sep + 1)
  if (!Number.isNaN(Date.parse(createdAtIso))) return { createdAtIso, matchId }
  return undefined
}

/** Name-keyed directory keyset marker: `<name>~<id>` (names may contain `~`; id is last). */
export function encodeNameKeyset(name: string, id: string): string {
  return `${name}~${id}`
}

/** Inverse of `encodeNameKeyset`; undefined when the marker is malformed. */
export function decodeNameKeyset(after: string): { name: string; id: string } | undefined {
  const sep = after.lastIndexOf("~")
  if (sep <= 0 || sep === after.length - 1) return undefined
  const name = after.slice(0, sep)
  const id = after.slice(sep + 1)
  return name.length > 0 && id.length > 0 ? { name, id } : undefined
}
