import React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"

/**
 * Batch 118: the hub is the platform→league discovery edge of the SaaS
 * federation (the CricHeroes-style model: every league is its own
 * discoverable domain). Search engines traverse that edge better with an
 * ItemList of the listed leagues — but ONLY the leagues whose verified
 * public host exists: `hubLeagueUrl` returns null for unverifiable
 * subdomains, and a sitemap/JSON-LD must never advertise a URL nobody
 * resolved. Positions are sequential and deterministic.
 */
const league = (over: Partial<Record<string, any>> = {}) => ({
  tenantId: "00000000-0000-4000-8000-000000000001",
  name: "Falcon Premier League",
  slug: "falcon",
  url: null,
  publishedCompetitions: 3,
  liveMatches: 1,
  listedAt: new Date(0),
  ...over,
})

afterEach(() => vi.resetModules())

describe("Hub discovery ItemList (Batch 118) — only verified hosts are advertised", () => {
  it("builds an ItemList ONLY from leagues with a verified public url, positions sequential", async () => {
    const { buildHubItemList } = await import("../lib/hub-structured-data")
    const data = buildHubItemList({
      leagues: [
        league({ name: "Alpha League", url: "https://alpha.example.com" }),
        league({ name: "No-Domain League" }),
        league({ tenantId: "00000000-0000-4000-8000-000000000002", name: "Beta League", url: "https://beta.example.com" }),
      ],
      complete: true,
      limit: 50,
    }) as unknown as Record<string, any>
    expect(data["@type"]).toBe("ItemList")
    expect(data.numberOfItems).toBe(2)
    expect(data.itemListElement.map((item: any) => item.item.name)).toEqual(["Alpha League", "Beta League"])
    expect(data.itemListElement.map((item: any) => item.item.url)).toEqual(["https://alpha.example.com", "https://beta.example.com"])
    expect(data.itemListElement.map((item: any) => item.position)).toEqual([1, 2])
    expect(JSON.stringify(data)).not.toContain("No-Domain League")
    // Batch 121: the counts live in the card too — the same numbers the
    // rendered hub page shows, truthfully pluralized.
    expect(data.itemListElement[0].item.description).toBe("3 published competitions · 1 live fixture")
  })

  it("a null read (or one where nothing is verifiable) builds nothing — no fabricated entries", async () => {
    const { buildHubItemList } = await import("../lib/hub-structured-data")
    expect(buildHubItemList(null)).toBeNull()
    expect(buildHubItemList({ leagues: [league()], complete: true, limit: 50 })).toBeNull()
  })

  it("the hub page skeleton renders the JSON-LD script verbatim through a generic emitter", async () => {
    const { JsonLd } = await import("../components/json-ld")
    const html = renderToStaticMarkup(
      React.createElement(JsonLd, { data: { "@type": "ItemList", numberOfItems: 1, itemListElement: [] } }),
    )
    expect(html).toContain('type="application/ld+json"')
    expect(html).toContain('"@type":"ItemList"')
  })
})
