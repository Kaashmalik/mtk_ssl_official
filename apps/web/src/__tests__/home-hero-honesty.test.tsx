import { afterEach, describe, expect, it, vi } from "vitest"

/**
 * Batch 130: the landing page's stat chips must be TRUTHFUL BY
 * CONSTRUCTION. "Live Scoring" and "Pro Analytics" describe shipped
 * capabilities — fine. "500+ Teams" invented a number the platform cannot
 * prove (and which would change league by league on a multi-tenant SaaS).
 * A visitor who counts the teams on the hub and finds 40 has been lied to
 * on the most important page. The pin: NO numeric "+ teams" claims in the
 * hero, the capability chips stay, and the real CTA is untouched.
 */

afterEach(() => {
  vi.resetModules()
  ;(globalThis as any).__batch130Branding = undefined
})

vi.mock("@/lib/request-brand", () => ({
  readRequestBrand: vi.fn(async () => (globalThis as any).__batch130Branding ?? null),
}))

vi.mock("@/components/providers", () => ({ useClerkReady: () => true }))
vi.mock("@mtk/ui/components/theme-toggle", () => ({ ThemeToggle: () => null }))
vi.mock("@mtk/ui/components/ui/motion-wrapper", () => ({
  MotionWrapper: (props: { children?: unknown }) => props.children,
}))
vi.mock("@clerk/nextjs", () => ({
  SignInButton: (props: { children?: unknown }) => props.children,
  SignedIn: (props: { children?: unknown }) => props.children,
  SignedOut: (props: { children?: unknown }) => props.children,
  UserButton: () => null,
}))

async function heroTexts(pulse: unknown = null): Promise<string[]> {
  const mod = (await import("../components/home-content")) as { HomeContent: (p: any) => any }
  const out: string[] = []
  // Client component: CALL it (returns its JSX), then walk — executing any
  // nested function components so client subtrees expand.
  const walk = (node: any, depth = 0): void => {
    if (Array.isArray(node)) return node.forEach((c) => walk(c, depth))
    if (typeof node === "string" || typeof node === "number") { out.push(String(node)); return }
    if (node === null || typeof node !== "object" || !node.props) return
    if (typeof node.type === "function" && depth < 8) {
      walk((node.type as any)(node.props), depth + 1)
      return
    }
    walk(node.props.children, depth)
  }
  walk(mod.HomeContent({ brandName: "Shakir Super League", pulse }))
  return out
}

describe("Home hero honesty (Batch 130)", () => {
  it("the hero carries NO invented numeric team-count claim", async () => {
    const text = (await heroTexts()).join(" ")
    expect(text).not.toMatch(/\d+\+?\s*Teams/i)
    expect(text).not.toContain("500+")
  })

  it("the stat chips keep the shipped capabilities — truth by construction", async () => {
    const text = (await heroTexts()).join(" ")
    expect(text).toContain("Live Scoring")
    expect(text).toContain("Pro Analytics")
  })
})

describe("Home landing honesty (review gap closure)", () => {
  const pulse = (overrides: Record<string, unknown> = {}) => ({
    leagues: 3,
    competitions: 5,
    liveMatches: 0,
    complete: true,
    featured: [{ tenantId: "t1", name: "Falcon Premier League", url: null, liveMatches: 0, publishedCompetitions: 2 }],
    ...overrides,
  })

  it("carries no invented readiness metric or always-on live badge", async () => {
    const text = (await heroTexts()).join(" ")
    expect(text).not.toContain("92%")
    expect(text).not.toMatch(/readiness/i)
    expect(text).not.toMatch(/live now/i)
  })

  it("labels the scorer illustration as sample data", async () => {
    const text = (await heroTexts()).join(" ")
    expect(text).toContain("Sample data")
  })

  it("renders no activity numbers at all without a trustworthy hub read", async () => {
    const text = (await heroTexts(null)).join(" ")
    expect(text).not.toContain("On the public hub right now")
  })

  it("shows the real hub counts it was given, and never claims live matches when there are none", async () => {
    const text = (await heroTexts(pulse())).join(" ")
    expect(text).toContain("On the public hub right now")
    expect(text).toContain("Falcon Premier League")
    expect(text).toContain("Matches live now")
    expect(text).not.toMatch(/\d+ live\b/)
  })

  it("discloses an incomplete hub read instead of presenting it as the total", async () => {
    const text = (await heroTexts(pulse({ complete: false, leagues: 50 }))).join(" ")
    expect(text).toContain("50+")
  })

  it("invites the first league honestly when nothing is listed", async () => {
    const text = (await heroTexts(pulse({ leagues: 0, competitions: 0, featured: [] }))).join(" ")
    expect(text).toContain("No league has listed itself publicly yet")
  })
})
