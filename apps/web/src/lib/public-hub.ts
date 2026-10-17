import { db, tenants, tournaments, matches } from "@mtk/database"
import {
  HUB_LISTED,
  hubListingEligible,
} from "@mtk/database/lib/public-hub-policy"
import {
  PUBLISHED_MATCH_STATUS_VALUES,
  PUBLISHED_TOURNAMENT_STATUS_VALUES,
} from "@mtk/database/lib/publication-policy"
import { and, asc, count, eq, inArray, isNull, or, sql } from "drizzle-orm"

/**
 * PUB-02 cross-league hub read models.
 *
 * These are the ONLY cross-tenant reads the public surface performs, and the
 * schema is shaped so an accidental over-read cannot happen:
 *
 * 1. The shared `hubListingEligible` policy (active + explicitly listed +
 *    recorded listing time) is expressed IN THE WHERE clause — the database,
 *    not row-manipulation code, filters leagues out.
 * 2. Every aggregate joins through the exact publication predicates the
 *    single-league public pages use (`PUBLISHED_*_STATUS_VALUES`). A league
 *    being listed exposes only what is already published; drafts and
 *    cancelled fixtures are invisible even for listed leagues.
 * 3. Bounded reads with deterministic ordering; overflow is reported as an
 *    explicit `complete: false`, never silently truncated or paginated.
 * 4. No permalink-tier exists: the hub links only to each league's verified
 *    public host when one exists (`hubLeagueUrl` returns null otherwise), and
 *    an unlisted link is never created by this module.
 */

/** Hub listings are bounded; the page discloses incompleteness when exceeded. */
export const PUBLIC_HUB_LEAGUE_LIMIT = 50

export type HubLeagueSummary = {
  tenantId: string
  name: string
  slug: string
  url: string | null
  publishedCompetitions: number
  liveMatches: number
  listedAt: Date
}

export type HubLeaguesRead = {
  leagues: HubLeagueSummary[]
  /** False when more eligible leagues exist beyond the bounded page. */
  complete: boolean
  limit: number
}

/**
 * Resolves the verified public host for a listed league. Only verified +
 * SSL custom domains qualify as an absolute cross-league link; subdomain
 * links depend on the platform root domain, which the hub cannot verify for
 * a tenant, so they are not fabricated here (null = render name without a
 * link). Reserved-platform hosts never become league links.
 */
export function hubLeagueUrl(league: {
  slug: string
  customDomain: string | null
  customDomainVerified: boolean
  sslEnabled: boolean
}): string | null {
  if (league.customDomain && league.customDomainVerified === true && league.sslEnabled === true) {
    return `https://${league.customDomain}`
  }
  return null
}

/**
 * Listed, active leagues on the public hub with their published-summary
 * counts. Counts come from two grouped aggregate queries joined back in
 * memory, so one over-eager aggregate can never widen the league list.
 */
export async function readListedHubLeagues(): Promise<HubLeaguesRead> {
  const leagueRows = await db
    .select({
      tenantId: tenants.id,
      name: tenants.name,
      slug: tenants.slug,
      customDomain: tenants.customDomain,
      customDomainVerified: tenants.customDomainVerified,
      sslEnabled: tenants.sslEnabled,
      hubListedAt: tenants.hubListedAt,
    })
    .from(tenants)
    .where(and(
      eq(tenants.isActive, true),
      eq(tenants.hubListingStatus, HUB_LISTED),
      sql`${tenants.hubListedAt} IS NOT NULL`,
    ))
    .orderBy(asc(tenants.name), asc(tenants.id))
    .limit(PUBLIC_HUB_LEAGUE_LIMIT + 1)

  // Redundant with the WHERE by construction, but the shared policy stays the
  // single authority: an inconsistent row (listed without a timestamp) can
  // never reach the hub even if a future migration regresses the constraint.
  const eligible = leagueRows.filter((row) => hubListingEligible({
    hubListingStatus: HUB_LISTED,
    hubListedAt: row.hubListedAt,
    isActive: true,
  }))
  const page = eligible.slice(0, PUBLIC_HUB_LEAGUE_LIMIT)
  const complete = eligible.length <= PUBLIC_HUB_LEAGUE_LIMIT

  const competitionCounts = await readPublishedCompetitionCounts(page.map((row) => row.tenantId))
  const liveCounts = await readLiveMatchCounts(page.map((row) => row.tenantId))

  return {
    leagues: page.map((row) => ({
      tenantId: row.tenantId,
      name: row.name,
      slug: row.slug,
      url: hubLeagueUrl(row),
      listedAt: row.hubListedAt as Date,
      publishedCompetitions: competitionCounts.get(row.tenantId) ?? 0,
      liveMatches: liveCounts.get(row.tenantId) ?? 0,
    })),
    complete,
    limit: PUBLIC_HUB_LEAGUE_LIMIT,
  }
}

/** Published competitions per listed league (same statuses as public detail pages). */
async function readPublishedCompetitionCounts(tenantIds: string[]): Promise<Map<string, number>> {
  if (tenantIds.length === 0) return new Map()
  const rows = await db
    .select({ tenantId: tournaments.tenantId, competitions: count() })
    .from(tournaments)
    .where(and(
      inArray(tournaments.tenantId, tenantIds),
      inArray(tournaments.status, [...PUBLISHED_TOURNAMENT_STATUS_VALUES]),
    ))
    .groupBy(tournaments.tenantId)
  return new Map(rows.map((row) => [row.tenantId, row.competitions]))
}

/**
 * Live fixtures per listed league. A fixture counts only when its own status
 * is published AND it has no unpublished parent — the same parent-gating rule
 * `readPublishedMatch` enforces for single-league pages.
 */
async function readLiveMatchCounts(tenantIds: string[]): Promise<Map<string, number>> {
  if (tenantIds.length === 0) return new Map()
  const rows = await db
    .select({ tenantId: matches.tenantId, live: count() })
    .from(matches)
    .leftJoin(
      tournaments,
      and(eq(tournaments.id, matches.tournamentId), eq(tournaments.tenantId, matches.tenantId)),
    )
    .where(and(
      inArray(matches.tenantId, tenantIds),
      inArray(matches.status, [...PUBLISHED_MATCH_STATUS_VALUES]),
      sql`${matches.status} = 'live'`,
      or(isNull(matches.tournamentId), inArray(tournaments.status, [...PUBLISHED_TOURNAMENT_STATUS_VALUES])),
    ))
    .groupBy(matches.tenantId)
  return new Map(rows.map((row) => [row.tenantId, row.live]))
}
