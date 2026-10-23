import { afterEach, describe, expect, it, vi } from "vitest"

/**
 * Batch 127: two honest-UX fixes on the public surfaces.
 *
 * 1. The sign-in page is already tenant-STYLED (logo, colors, background),
 *    but its metadata is a static export with the platform name hardcoded —
 *    a branded tenant's sign-in page advertises the PLATFORM in every share
 *    preview and browser tab. Metadata must be per-host, generated from the
 *    same branded read the styling uses.
 * 2. The landing page's "Watch Demo" button had no href and no handler — a
 *    dead end as the SECOND call-to-action on the most important page. The
 *    honest replacement points visitors at the real, live public surface
 *    (/hub) instead of a video that does not exist.
 */

afterEach(() => {
  vi.resetModules()
  ;(globalThis as any).__batch127Branding = undefined
})

vi.mock("@/lib/tenant", () => ({
  getTenantWithBranding: vi.fn(async () => (globalThis as any).__batch127Branding ?? null),
}))

vi.mock("@/app/sign-in/[[...sign-in]]/clerk-sign-in", () => ({ ClerkSignIn: () => null }))

// Client boundaries for executing the real hero component (same stand-ins
// as the Batch 125 home harness — the brand wiring itself is not mocked).
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

vi.mock("@/lib/request-brand", () => ({
  readRequestBrand: vi.fn(async () => {
    const branding = (globalThis as any).__batch127Branding?.branding
    return branding?.appName ? { appName: branding.appName } : null
  }),
}))

describe("Sign-in white-label metadata (Batch 127)", () => {
  it("a branded tenant's sign-in metadata advertises THE TENANT, never the platform", async () => {
    ;(globalThis as any).__batch127Branding = { tenant: { id: "t1" }, branding: { appName: "Falcon Premier League" } }
    const mod = await import("../app/sign-in/[[...sign-in]]/page")
    expect(typeof (mod as any).generateMetadata).toBe("function")
    const meta = await (mod as any).generateMetadata()
    expect(JSON.stringify(meta)).toContain("Falcon Premier League")
    expect(JSON.stringify(meta)).not.toContain("Shakir Super League")
  })

  it("an unconfigured host keeps the platform-branded fallback", async () => {
    ;(globalThis as any).__batch127Branding = null
    const mod = await import("../app/sign-in/[[...sign-in]]/page")
    const meta = await (mod as any).generateMetadata()
    expect(JSON.stringify(meta)).toContain("Shakir Super League")
  })

  it("the static metadata export is GONE — no per-host-blind platform strings can ship again", async () => {
    const mod = await import("../app/sign-in/[[...sign-in]]/page") as any
    expect(mod.metadata).toBeUndefined()
  })
})

describe("Hero CTA goes somewhere real (Batch 127)", () => {
  async function heroTree() {
    vi.resetModules()
    ;(globalThis as any).__batch127Branding = { tenant: { id: "t1" }, branding: { appName: "Falcon Premier League" } }
    const HomePage = (await import("../app/page")).default
    return HomePage()
  }

  function walk(node: any, visit: (el: any) => void): void {
    if (Array.isArray(node)) return node.forEach((child) => walk(child, visit))
    if (node === null || typeof node !== "object") return
    if (typeof node.type !== "undefined" && node.props) {
      visit(node)
      walk((node.props as any)?.children, visit)
    }
  }

  it("the secondary CTA links to the live public hub — no dead buttons on the landing page", async () => {
    const tree = await heroTree()
    // The hero is a client component: find its element in the server tree,
    // execute it with the EXACT props the page passed, and walk the result.
    let hero: any = null
    walk(tree, (el) => {
      if (!hero && typeof el.type === "function" && el.type.name === "HomeContent") hero = el
    })
    expect(hero).toBeTruthy()
    const hrefs: string[] = []
    const labels: string[] = []
    const texts = (n: any, out: string[]): void => {
      if (Array.isArray(n)) return n.forEach((c) => texts(c, out))
      if (typeof n === "string" || typeof n === "number") { out.push(String(n)); return }
      if (n === null || typeof n !== "object" || !n.props) return
      texts(n.props.children, out)
    }
    walk((hero.type as any)(hero.props), (el) => {
      if (typeof el.props?.href === "string") {
        hrefs.push(el.props.href)
        const out: string[] = []
        texts(el.props.children, out)
        labels.push(out.join(""))
      }
    })
    expect(hrefs).toContain("/hub")
    const hubLabel = labels[hrefs.indexOf("/hub")]
    expect(hubLabel.toLowerCase()).toContain("explore")
    expect(labels.join(" ")).not.toContain("Watch Demo")
  })
})
