import { auth } from "@clerk/nextjs/server"
import { db, users, players, playerSeasonStats, tournaments, tenants } from "@mtk/database"
import { careerConsentGranted, mergeConsentedCareer, type ConsentedCareer } from "@mtk/database/lib/career-records"
import { PUBLISHED_TOURNAMENT_STATUS_VALUES } from "@mtk/database/lib/publication-policy"
import { and, eq, inArray, sum } from "drizzle-orm"

/**
 * PUB-02 hub slice: the signed-in person's cross-league career view.
 *
 * Publication-approved by construction: every league's totals aggregate ONLY
 * `player_season_stats` rows joined to a PUBLISHED tournament of that same
 * league — the exact publication predicates the public leaderboards use.
 * The consent gate (`mergeConsentedCareer` + `careerConsentGranted`, PUB-03)
 * is the authority for folding across league boundaries: without the
 * person's affirmative consent this read returns no career at all.
 * Everything here is the person's OWN view (session-derived identity, never
 * a client argument) — no public cross-league surface exists yet, so the
 * linkage stays private until a public-profile design ships.
 */
export type CareerHubLeague = {
  tenantId: string
  leagueName: string
  runsScored: number
  wicketsTaken: number
}

export type CareerHub = {
  consented: boolean
  /** Null unless consented; the fail-closed merge with per-league provenance. */
  career: ConsentedCareer<CareerHubLeague> | null
  /** Display-enriched league rows; zeros are never fabricated for leagues without published stats. */
  leagues: CareerHubLeague[]
}

type LeagueAggregateRow = {
  tenantId: string
  leagueName: string
  totalRuns: number | null
  totalWickets: number | null
}

/** Pure display mapping: normalize SQL sums and enrich provenance for the UI. */
export function toCareerLeagues(rows: LeagueAggregateRow[]): CareerHubLeague[] {
  return rows.map((row) => ({
    tenantId: row.tenantId,
    leagueName: row.leagueName,
    runsScored: row.totalRuns ?? 0,
    wicketsTaken: row.totalWickets ?? 0,
  }))
}

/** Per-league, published-only totals for every player row linked to this account. */
async function readPublishedLeagueTotals(userId: string): Promise<LeagueAggregateRow[]> {
  return db
    .select({
      tenantId: players.tenantId,
      leagueName: tenants.name,
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
    .innerJoin(tenants, and(eq(tenants.id, players.tenantId), eq(tenants.isActive, true)))
    .where(and(eq(players.userId, userId), eq(players.isActive, true)))
    .groupBy(players.tenantId, tenants.name)
}

/**
 * Consent-gated cross-league career for the Clerk session's account. All
 * identity comes from the session's clerkId → users row; an inactive or
 * missing account fails closed exactly like the consent writer.
 */
export async function readConsentedCareerByClerkId(clerkId: string): Promise<CareerHub> {
  const [account] = await db
    .select({ id: users.id, isActive: users.isActive, publicCareerConsentAt: users.publicCareerConsentAt })
    .from(users)
    .where(eq(users.clerkId, clerkId))
    .limit(1)
  if (!account || account.isActive !== true) throw new Error("Forbidden: career account unavailable")

  const consented = careerConsentGranted(account)
  if (!consented) return { consented: false, career: null, leagues: [] }

  const aggregates = await readPublishedLeagueTotals(account.id)
  const leagues = toCareerLeagues(aggregates)
  // One authoritative fold; duplicate league totals here would be a query bug.
  const career = mergeConsentedCareer(leagues, consented)
  return { consented, career, leagues }
}

/** Session-authenticated wrapper for server pages. */
export async function readMyCareerHub(): Promise<CareerHub> {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  return readConsentedCareerByClerkId(userId)
}
