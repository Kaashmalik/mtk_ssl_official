import type { Metadata } from "next"
import { requirePublicTenantId } from "@/lib/public-tenant"
import { readPublishedMatch, readPublishedMatchTeams } from "@/lib/public-visibility"
import { buildPageMetadata } from "@/lib/site-metadata"

/**
 * Batch 114: metadata resolution for the PUBLIC match centre. This route is
 * unauthenticated and shareable, so its social-card contract must be bound by
 * the SAME publication predicates that gate the page render: a match that the
 * visibility layer will not serve gets NOINDEX with no fabricated title, and
 * any read failure fails closed the same way. A published match yields the
 * team names as the title and a description assembled only from truthful
 * fields (result sentence, format, scheduled date).
 */
const NOINDEX: Metadata = { robots: { index: false, follow: false } }

export async function resolvePublicMatchMetadata(matchId: string): Promise<Metadata> {
  try {
    const tenantId = await requirePublicTenantId()
    const match = await readPublishedMatch(tenantId, matchId)
    if (!match) return NOINDEX
    const { teamA, teamB } = await readPublishedMatchTeams(tenantId, match)
    if (!teamA || !teamB) return NOINDEX

    const title = `${teamA.name} vs ${teamB.name}`
    const facts = [match.result, match.matchFormat, match.scheduledDate]
      .filter(fact => typeof fact === "string" || typeof fact === "number")
      .map(fact => String(fact))
      .filter(fact => fact.length > 0)

    return {
      ...buildPageMetadata({ title, description: `Match centre: ${facts.join(" · ")}`, path: `/matches/${matchId}` }),
      robots: { index: true, follow: true },
    }
  } catch {
    return NOINDEX
  }
}
