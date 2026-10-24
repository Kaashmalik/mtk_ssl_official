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

async function heroTexts(): Promise<string[]> {
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
  walk(mod.HomeContent({ brandName: "Shakir Super League" }))
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
