import { db, users, players, playerSeasonStats, tournaments, tenants } from "@mtk/database"
import { isUuid } from "@mtk/contracts"
import {
  careerProfilePublishable,
  mergeConsentedCareer,
  type ConsentedCareer,
} from "@mtk/database/lib/career-records"
import { HUB_LISTED, hubListingEligible } from "@mtk/database/lib/public-hub-policy"
import { PUBLISHED_TOURNAMENT_STATUS_VALUES } from "@mtk/database/lib/publication-policy"
import { hubLeagueUrl } from "@/lib/public-hub"
import { and, asc, eq, inArray, sql, sum } from "drizzle-orm"
import { minorConsentPublicSql } from "./public-visibility"

/**
 * PUB-02: the PUBLIC cross-league career profile read model.
 *
 * This is the second (and only other) cross-tenant read the public surface
 * performs, and it is gated by three independent authorities — every one of
 * them expressed in the WHERE clause so an accidental over-read cannot even
 * execute:
 *
 * 1. The person's own affirmative consent + active account
 *    (`careerProfilePublishable`, PUB-03's flag). Without it this module
 *    returns `null` after the account lookup alone and issues NO aggregate
 *    query — an ineligible profile is indistinguishable from a missing one.
 * 2. The league-owner's hub-listing decision: only leagues that are
 *    themselves `hubListingEligible` (active + explicitly listed + recorded
 *    listing time) contribute. Nothing from a league whose owner kept it out
 *    of the public hub can leak onto this surface through a player.
 * 3. The exact per-league publication predicates the single-league public
 *    pages use (`PUBLISHED_TOURNAMENT_STATUS_VALUES`); drafts and cancelled
 *    competitions are invisible even in listed leagues.
 *
 * Privacy posture of this slice, recorded honestly: the profile renders
 * LEAGUE names and aggregate totals only — never the account's name, email
 * or any roster personal name — and there is no public directory of profiles,
 * so a profile is reachable only via its own (unguessable) link. The account
 * page surfaces that link to its owner once consent is granted. A future
 * identity-display slice would need its own explicit consent axis.
 */
const PUBLIC_CAREER_PROFILE_LEAGUE_LIMIT = 50

export type PublicCareerLeague = {
  tenantId: string
  leagueName: string
  /** Verified custom-domain host of the league, or null (rendered without a link). */
  url: string | null
  runsScored: number
  wicketsTaken: number
}

export type PublicCareerProfile = {
  /** The consented, folded career view with per-league provenance. */
  career: ConsentedCareer<PublicCareerLeague>
  /** False when more qualifying leagues exist beyond the bounded page. */
  complete: boolean
  limit: number
}

type LeagueAggregateRow = {
  tenantId: string
  leagueName: string
  slug: string
  customDomain: string | null
  customDomainVerified: boolean
  sslEnabled: boolean
  hubListedAt: Date | null
  totalRuns: number | null
  totalWickets: number | null
}

/** Pure display mapping: normalize SQL sums and enrich each league with its verified public link. */
export function toPublicCareerLeagues(rows: LeagueAggregateRow[]): PublicCareerLeague[] {
  return rows.map((row) => ({
    tenantId: row.tenantId,
    leagueName: row.leagueName,
    url: hubLeagueUrl(row),
    runsScored: row.totalRuns ?? 0,
    wicketsTaken: row.totalWickets ?? 0,
  }))
}

/**
 * Consent-gated, hub-listed, published-only cross-league career for an
 * anonymous visitor. `userId` is the account's internal id (as linked from
 * the owner's account page); a missing, inactive or unconsenting account
 * returns `null` and the caller renders notFound.
 */
export async function readPublicCareerProfile(userId: string): Promise<PublicCareerProfile | null> {
  // Batch 147: untrusted `[userId]` segments fail CLOSED before any query —
  // a non-uuid id can never satisfy the cast, so a doomed query whose catch
  // rendered a fake "please try again" (HTTP 200) is now an honest 404.
  if (!isUuid(userId)) return null
  const [account] = await db
    .select({ id: users.id, isActive: users.isActive, publicCareerConsentAt: users.publicCareerConsentAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  // Fail closed BEFORE any cross-league read: an ineligible account must be
  // indistinguishable from a nonexistent profile, and must not trigger one.
  if (!careerProfilePublishable(account)) return null

  const aggregateRows = await db
    .select({
      tenantId: players.tenantId,
      leagueName: tenants.name,
      slug: tenants.slug,
      customDomain: tenants.customDomain,
      customDomainVerified: tenants.customDomainVerified,
      sslEnabled: tenants.sslEnabled,
      hubListedAt: tenants.hubListedAt,
      totalRuns: sum(playerSeasonStats.runsScored).mapWith(Number),
      totalWickets: sum(playerSeasonStats.wicketsTaken).mapWith(Number),
    })
    .from(players)
    .innerJoin(
      playerSeasonStats,
      and(eq(playerSeasonStats.playerId, players.id), eq(playerSeasonStats.tenantId, players.tenantId)),
    )
    .innerJoin(
      tournaments,
      and(
        eq(tournaments.id, playerSeasonStats.tournamentId),
        eq(tournaments.tenantId, players.tenantId),
        inArray(tournaments.status, [...PUBLISHED_TOURNAMENT_STATUS_VALUES]),
      ),
    )
    .innerJoin(
      tenants,
      and(
        eq(tenants.id, players.tenantId),
        eq(tenants.isActive, true),
        eq(tenants.hubListingStatus, HUB_LISTED),
        sql`${tenants.hubListedAt} IS NOT NULL`,
      ),
    )
    .where(and(
      eq(players.userId, userId),
      // Minor-consent gate (Batch 132): a proven minor's contributions are
      // folded out of the PUBLIC career aggregate without recorded guardian
      // consent. All-rows-withheld aggregates just as empty = ineligible on
      // this page, which the page already renders indistinguishably.
      minorConsentPublicSql,
    ))
    .groupBy(
      players.tenantId,
      tenants.name,
      tenants.slug,
      tenants.customDomain,
      tenants.customDomainVerified,
      tenants.sslEnabled,
      tenants.hubListedAt,
    )
    .orderBy(asc(tenants.name), asc(players.tenantId))
    .limit(PUBLIC_CAREER_PROFILE_LEAGUE_LIMIT + 1)

  // Redundant with the WHERE by construction, but the shared policy stays the
  // single authority — an inconsistent row (listed without a timestamp) can
  // never surface, exactly like the hub directory read.
  const eligible = aggregateRows.filter((row) =>
    hubListingEligible({ hubListingStatus: HUB_LISTED, hubListedAt: row.hubListedAt, isActive: true }),
  )
  const page = eligible.slice(0, PUBLIC_CAREER_PROFILE_LEAGUE_LIMIT)
  // Totals fold ONLY the leagues shown: an overflow page never silently adds
  // hidden numbers into the headline career total.
  const career = mergeConsentedCareer(toPublicCareerLeagues(page), true)
  if (!career) return null

  return { career, complete: eligible.length <= PUBLIC_CAREER_PROFILE_LEAGUE_LIMIT, limit: PUBLIC_CAREER_PROFILE_LEAGUE_LIMIT }
}
