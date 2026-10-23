import type { Metadata } from "next"
import { requirePublicTenantId } from "@/lib/public-tenant"
import { readPublishedTournament } from "@/lib/public-visibility"
import { buildPageMetadata } from "@/lib/site-metadata"

/**
 * Batch 116: metadata resolution for the PUBLIC tournament page. The same
 * contract as the match centre (Batch 114): bound by the publication
 * predicates that gate the render, noindex without a title for anything
 * unpublished/foreign/erroring, and a description assembled only from
 * truthful fields with a hard bound (a database text column must never
 * flow into a social card verbatim).
 */
const NOINDEX: Metadata = { robots: { index: false, follow: false } }
const DESCRIPTION_LIMIT = 280

function bounded(value: string): string {
  return value.length <= DESCRIPTION_LIMIT ? value : `${value.slice(0, DESCRIPTION_LIMIT).trimEnd()}…`
}

export async function resolvePublicTournamentMetadata(id: string): Promise<Metadata> {
  try {
    const tenantId = await requirePublicTenantId()
    const tournament = await readPublishedTournament(tenantId, id)
    if (!tournament || typeof tournament.name !== "string" || tournament.name.length === 0) return NOINDEX

    const facts = [tournament.description, tournament.format, tournament.startDate, tournament.endDate]
      .filter(fact => typeof fact === "string" && fact.length > 0)
      .map(fact => String(fact))

    const title = tournament.name
    const description = bounded(`Tournament: ${title}. ${facts.join(" · ")}`)

    return {
      ...buildPageMetadata({ title, description, path: `/tournaments/${id}` }),
      robots: { index: true, follow: true },
    }
  } catch {
    return NOINDEX
  }
}
