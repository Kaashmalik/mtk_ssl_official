import React from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import HubPage from "@/app/hub/page"

const mocks = vi.hoisted(() => ({ leagues: vi.fn() }))
vi.mock("next/cache", () => ({ unstable_noStore: () => {} }))
vi.mock("@/lib/public-hub", () => ({ readListedHubLeagues: mocks.leagues }))
// The shared public chrome is an async server component (request brand read);
// these pins are about the hub's own content, so the shell passes through.
vi.mock("@/components/public/public-shell", () => ({
  PublicShell: (props: { children?: React.ReactNode }) => props.children,
}))

/** Collects rendered text from the element tree the page returns (whitespace-normalized).
 * Batch 134: league cards are now the extracted HubLeagueCard component — the walk
 * EXECUTES function-typed elements so its assertions still reach the card contents
 * (same intent, new render path). */
function pageText(node: unknown): string {
  const out: string[] = []
  const walk = (inner: unknown, depth = 0): void => {
    if (typeof inner === "string" || typeof inner === "number") { out.push(String(inner)); return }
    if (!React.isValidElement(inner)) return
    if (depth < 8 && typeof inner.type === "function") {
      walk((inner.type as (p: unknown) => unknown)(inner.props), depth + 1)
      return
    }
    const props = inner.props as { children?: React.ReactNode }
    React.Children.forEach(props.children, (child) => walk(child, depth))
  }
  walk(node)
  return out.join(" ").replace(/\s+/g, " ")
}

function collectElements(node: unknown, type: string, depth = 0): React.ReactElement<Record<string, unknown>>[] {
  if (!React.isValidElement(node)) return []
  if (depth < 8 && typeof node.type === "function") {
    return collectElements((node.type as (p: unknown) => unknown)(node.props), type, depth + 1)
  }
  const props = node.props as { children?: React.ReactNode }
  return [
    ...(node.type === type ? [node as React.ReactElement<Record<string, unknown>>] : []),
    ...React.Children.toArray(props.children).flatMap(child => collectElements(child, type, depth)),
  ]
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe("Public cross-league hub page (PUB-02)", () => {
  it("renders only listed leagues with published counts, linking verified domains", async () => {
    mocks.leagues.mockResolvedValue({
      leagues: [
        { tenantId: "t1", name: "Alpha League", slug: "alpha", url: "https://play.alpha.com",
          publishedCompetitions: 3, liveMatches: 1, listedAt: new Date("2026-10-17T00:00:00Z") },
        { tenantId: "t2", name: "Beta League", slug: "beta", url: null,
          publishedCompetitions: 0, liveMatches: 0, listedAt: new Date("2026-10-17T00:00:00Z") },
      ],
      complete: true,
      limit: 50,
    })

    const tree = await HubPage()
    const text = pageText(tree)

    expect(text).toContain("Alpha League")
    expect(text).toContain("Beta League")
    expect(text).toContain("0 live fixtures")
    expect(text).toContain("explicitly chosen to be publicly discoverable")
    const links = collectElements(tree, "a")
    expect(links).toHaveLength(1)
    expect(links[0].props.href).toBe("https://play.alpha.com")
  })

  it("discloses an incomplete bounded listing instead of truncating silently", async () => {
    mocks.leagues.mockResolvedValue({ leagues: [], complete: false, limit: 50 })
    const text = pageText(await HubPage())
    expect(text).toContain("first 50")
    expect(text).toContain("more published leagues exist")
  })

  it("renders an honest empty state when no league has published itself", async () => {
    mocks.leagues.mockResolvedValue({ leagues: [], complete: true, limit: 50 })
    const text = pageText(await HubPage())
    expect(text).toContain("No league has published itself yet.")
  })

  it("fails visibly without crashing and without exposing anything", async () => {
    mocks.leagues.mockRejectedValue(new Error("Connection refused"))
    const tree = await HubPage()
    const text = pageText(tree)
    expect(text).toContain("The hub could not be loaded")
    // No league rows were rendered from the failed read.
    expect(collectElements(tree, "a")).toHaveLength(0)
  })
})
