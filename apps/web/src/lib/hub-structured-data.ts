import type { HubLeaguesRead } from "@/lib/public-hub"

/**
 * Batch 118: the hub's ItemList JSON-LD — the platform→league discovery
 * edge. Only leagues with a VERIFIED public host (`hubLeagueUrl`-derived,
 * verified + SSL custom domains) appear: a discovery document must never
 * advertise a URL nobody resolved. Positions are sequential over the
 * admitted set, deterministic and independent of the source ordering
 * details. `null` means "nothing advertisable" — the page renders no
 * script at all rather than an empty or fabricated list.
 */
export type ItemListData = {
  "@context": "https://schema.org"
  "@type": "ItemList"
  numberOfItems: number
  itemListElement: Array<{ "@type": "ListItem"; position: number; item: { "@type": "Organization"; name: string; url: string; description: string } }>
}

export function buildHubItemList(read: HubLeaguesRead | null): ItemListData | null {
  if (!read) return null
  const admitted = read.leagues.filter(league => typeof league.url === "string" && league.url.length > 0)
  if (admitted.length === 0) return null
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    numberOfItems: admitted.length,
    itemListElement: admitted.map((league, index) => ({
      "@type": "ListItem",
      position: index + 1,
      item: {
        "@type": "Organization",
        name: league.name,
        url: league.url as string,
        // Batch 121: the same truthful counts the rendered hub card shows,
        // pluralized identically — machine readers see exactly what humans see.
        description: `${league.publishedCompetitions} published ${league.publishedCompetitions === 1 ? "competition" : "competitions"} · ${league.liveMatches} live ${league.liveMatches === 1 ? "fixture" : "fixtures"}`,
      },
    })),
  }
}
