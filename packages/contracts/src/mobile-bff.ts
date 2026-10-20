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
import type { PublicMatch } from "./public-reads"

/** Monotonic convention version for the mobile BFF surface. */
export const MOBILE_BFF_VERSION = 1 as const

/** The authenticated native BFF route map (paths relative to the web origin). */
export const MOBILE_BFF_ROUTES = {
  /** GET the signed-in member's match list (cursor paginated). */
  matches: "/api/mobile/matches",
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
}

/** Hard ceiling on a mobile BFF page (requests may ask for less, never more). */
export const MOBILE_BFF_MAX_PAGE_SIZE = 50 as const

/** Default page size when the client does not ask for a specific one. */
export const MOBILE_BFF_DEFAULT_PAGE_SIZE = 25 as const

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
