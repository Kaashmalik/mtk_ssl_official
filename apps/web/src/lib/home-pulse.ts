import { getTenantFromRequest } from "./tenant"
import { readListedHubLeagues } from "./public-hub"

/**
 * Real, published activity for the platform landing page.
 *
 * Built ONLY from `readListedHubLeagues()` - the same listing-policy and
 * publication-gated read the public hub uses - so the landing page can never
 * show more than the hub already does. Returns null (render nothing) when:
 *
 * - the request is on a league's own host: a white-labelled landing page must
 *   not advertise other leagues;
 * - the read fails: no number is better than an invented one.
 */
export type HomePulse = {
  leagues: number
  competitions: number
  liveMatches: number
  /** False when more listed leagues exist than the bounded hub read returns. */
  complete: boolean
  /** Up to four listed leagues, live ones first. */
  featured: { tenantId: string; name: string; url: string | null; liveMatches: number; publishedCompetitions: number }[]
}

export async function readHomePulse(): Promise<HomePulse | null> {
  try {
    if (await getTenantFromRequest(true)) return null
    const read = await readListedHubLeagues()
    const featured = [...read.leagues]
      .sort((a, b) => b.liveMatches - a.liveMatches || b.publishedCompetitions - a.publishedCompetitions)
      .slice(0, 4)
      .map(({ tenantId, name, url, liveMatches, publishedCompetitions }) => ({ tenantId, name, url, liveMatches, publishedCompetitions }))
    return {
      leagues: read.leagues.length,
      competitions: read.leagues.reduce((sum, league) => sum + league.publishedCompetitions, 0),
      liveMatches: read.leagues.reduce((sum, league) => sum + league.liveMatches, 0),
      complete: read.complete,
      featured,
    }
  } catch {
    return null
  }
}
