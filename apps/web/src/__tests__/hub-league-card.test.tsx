import React from "react"
import { describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"

/**
 * Batch 134: the hub is where the landing page's "Explore the platform"
 * CTA lands every visitor — and its league cards are beautiful in exactly
 * no dimension: the league name bare, no visit affordance beyond an
 * underlined link, and for a league WITHOUT a verified public domain
 * there is no explanation of WHY it isn't clickable (the intro paragraph
 * says it once, far above the cards). The card component is extracted
 * (same presentation-only pattern as PointsTable) and upgraded with ONLY
 * truthful affordances: a real visit affordance for linked leagues, and
 * an honest "No public site linked yet" chip for unlinked ones. Counts
 * and pluralization stay exactly as pinned before.
 */

const league = (over: Partial<Record<string, unknown>> = {}) => ({
  tenantId: "t1",
  name: "Falcon Premier League",
  url: "https://falcon.example.com" as string | null,
  publishedCompetitions: 2,
  liveMatches: 1,
  ...over,
})

async function card(over: Record<string, unknown> = {}): Promise<string> {
  vi.resetModules()
  const { HubLeagueCard } = await import("../components/hub/hub-league-card")
  return renderToStaticMarkup(React.createElement(HubLeagueCard, { league: league(over) as any }))
}

describe("Hub league cards (Batch 134)", () => {
  it("a league with a verified public domain gets a real visit affordance", async () => {
    const html = await card()
    expect(html).toContain('href="https://falcon.example.com"')
    expect(html).toContain("Visit league site")
    expect(html).toContain('rel="noopener noreferrer"')
  })

  it("an unlinked league explains WHY nothing is clickable — honestly, on the card", async () => {
    const html = await card({ url: null })
    expect(html).not.toContain('href=')
    expect(html).toContain("No public site linked yet")
  })

  it("the truthful counts line survives with its exact pluralization", async () => {
    const one = await card({ publishedCompetitions: 1, liveMatches: 1 })
    expect(one).toContain("1 published competition")
    expect(one).toContain("1 live fixture")
    const many = await card({ publishedCompetitions: 3, liveMatches: 0 })
    expect(many).toContain("3 published competitions")
    expect(many).toContain("0 live fixtures")
  })
})
