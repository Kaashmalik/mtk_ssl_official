import React from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import PublicCareerProfilePage from "@/app/hub/players/[userId]/page"

const mocks = vi.hoisted(() => ({
  profile: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND")
  }),
}))
vi.mock("next/cache", () => ({ unstable_noStore: () => {} }))
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }))
vi.mock("@/lib/public-career-profile", () => ({ readPublicCareerProfile: mocks.profile }))

/** Collects rendered text from the element tree the page returns (whitespace-normalized). */
function pageText(node: unknown): string {
  const out: string[] = []
  const walk = (inner: unknown) => {
    if (typeof inner === "string" || typeof inner === "number") { out.push(String(inner)); return }
    if (!React.isValidElement(inner)) return
    const props = inner.props as { children?: React.ReactNode }
    React.Children.forEach(props.children, (child) => walk(child))
  }
  walk(node)
  return out.join(" ").replace(/\s+/g, " ")
}

function collectElements(node: unknown, type: string): React.ReactElement<Record<string, unknown>>[] {
  if (!React.isValidElement(node)) return []
  const props = node.props as { children?: React.ReactNode }
  return [
    ...(node.type === type ? [node as React.ReactElement<Record<string, unknown>>] : []),
    ...React.Children.toArray(props.children).flatMap(child => collectElements(child, type)),
  ]
}

const PARAMS = (userId: string) => Promise.resolve({ userId })
const USER = "00000000-0000-4000-8000-0000000000a1"

beforeEach(() => {
  vi.resetAllMocks()
})

describe("Public career profile page (PUB-02 remainder)", () => {
  it("renders league rows with verified-domain links and the folded career total", async () => {
    mocks.profile.mockResolvedValue({
      career: {
        leagues: [
          { tenantId: "t1", leagueName: "Alpha", url: "https://play.alpha.com", runsScored: 120, wicketsTaken: 3 },
          { tenantId: "t2", leagueName: "Beta", url: null, runsScored: 80, wicketsTaken: 11 },
        ],
        totalRunsScored: 200,
        totalWicketsTaken: 14,
      },
      complete: true,
      limit: 50,
    })

    const tree = await PublicCareerProfilePage({ params: PARAMS(USER) })
    const text = pageText(tree)

    expect(text).toContain("Cricket career profile")
    expect(text).toContain("Alpha")
    expect(text).toContain("Beta")
    expect(text).toContain("200 runs · 14 wickets")
    expect(text).toContain("no personal details")
    const links = collectElements(tree, "a")
    expect(links).toHaveLength(1)
    expect(links[0].props.href).toBe("https://play.alpha.com")
  })

  it("answers notFound for an ineligible or unknown id — indistinguishable by design", async () => {
    mocks.profile.mockResolvedValue(null)
    await expect(PublicCareerProfilePage({ params: PARAMS(USER) })).rejects.toThrow("NEXT_NOT_FOUND")
    expect(mocks.notFound).toHaveBeenCalledTimes(1)
  })

  it("renders an honest zero state instead of fabricating leagues", async () => {
    mocks.profile.mockResolvedValue({
      career: { leagues: [], totalRunsScored: 0, totalWicketsTaken: 0 },
      complete: true,
      limit: 50,
    })
    const text = pageText(await PublicCareerProfilePage({ params: PARAMS(USER) }))
    expect(text).toContain("No published performances are currently visible")
  })

  it("discloses an incomplete bounded fold instead of silently hiding overflow", async () => {
    mocks.profile.mockResolvedValue({
      career: {
        leagues: [{ tenantId: "t1", leagueName: "Alpha", url: null, runsScored: 1, wicketsTaken: 0 }],
        totalRunsScored: 1,
        totalWicketsTaken: 0,
      },
      complete: false,
      limit: 50,
    })
    const text = pageText(await PublicCareerProfilePage({ params: PARAMS(USER) }))
    expect(text).toContain("first 50 qualifying leagues")
    expect(text).toContain("more published leagues contribute")
  })

  it("fails visibly without crashing and without exposing anything", async () => {
    mocks.profile.mockRejectedValue(new Error("Connection refused"))
    const tree = await PublicCareerProfilePage({ params: PARAMS(USER) })
    const text = pageText(tree)
    expect(text).toContain("could not be loaded")
    expect(collectElements(tree, "a")).toHaveLength(0)
    expect(collectElements(tree, "table")).toHaveLength(0)
  })
})
