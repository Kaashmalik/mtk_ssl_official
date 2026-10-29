import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The discoverability contract, now PER HOST (Batch 117 evolution of the
 * Batch 112 foundation). The platform reason: /leaderboards, /hall-of-fame
 * and /tournaments are TENANT-GATED — on a platform host with no tenant they
 * 404, so a platform-level sitemap advertising them would enumerate dead
 * URLs (the exact class Batch 113 pinned shut for file existence). The
 * sitemap and robots therefore resolve the request host: a TENANT host gets
 * its own sitemap (its published tournaments included) and its own robots
 * sitemap reference; the platform host advertises only routes that genuinely
 * exist there. Failures fall back to the platform set — never fabricated
 * entries.
 */
const seoMocks = vi.hoisted(() => ({
  headerValues: {} as Record<string, string>,
  context: vi.fn(),
  tournaments: vi.fn(),
}))

vi.mock("next/headers", () => ({
  headers: () => Promise.resolve({ get: (key: string) => seoMocks.headerValues[key.toLowerCase()] ?? null }),
}))
vi.mock("@/lib/public-tenant", () => ({ getPublicTenantContext: seoMocks.context }))
vi.mock("@/lib/public-visibility", () => ({ readPublishedTournaments: seoMocks.tournaments }))

describe("SEO routes and metadata (Batches 112-117)", () => {
  const ORIGINAL = { ...process.env }

  beforeEach(() => {
    seoMocks.headerValues = {}
    seoMocks.context.mockResolvedValue(null)
    seoMocks.tournaments.mockResolvedValue([])
  })

  afterEach(() => {
    process.env = { ...ORIGINAL }
    vi.resetModules()
  })

  async function load(path: string) {
    vi.resetModules()
    return import(path)
  }

  it("robots admits crawlers to public pages, blocks private surfaces, and references the sitemap", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://ssl.example.com"
    const robots = (await load("../app/robots.ts")).default as () => Promise<{ rules: { allow: string; disallow: string[] }[]; sitemap: string }>
    const out = await robots()
    expect(out.sitemap).toBe("https://ssl.example.com/sitemap.xml")
    expect(out.rules[0].allow).toBe("/")
    for (const path of ["/dashboard", "/api/", "/settings", "/impersonation", "/broadcast"]) {
      expect(out.rules[0].disallow).toContain(path)
    }
  })

  it("on a TENANT host, the sitemap enumerates the tenant's public routes AND its published tournaments (Batch 117)", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://ssl.example.com"
    seoMocks.headerValues = { host: "falcon.cricketLeague.com", "x-forwarded-proto": "https" }
    seoMocks.context.mockResolvedValue({ tenantId: "00000000-0000-4000-8000-000000000001", slug: "falcon" })
    seoMocks.tournaments.mockResolvedValue([
      { id: "00000000-0000-4000-8000-00000000000a", name: "Falcon Cup" },
      { id: "00000000-0000-4000-8000-00000000000b", name: "Falcon T20" },
    ])
    const sitemap = (await load("../app/sitemap.ts")).default as () => Promise<Array<{ url: string }>>
    const urls = (await sitemap()).map(entry => entry.url)
    for (const route of ["/", "/hub", "/leaderboards", "/hall-of-fame", "/tournaments"]) {
      expect(urls).toContain(`https://falcon.cricketLeague.com${route}`)
    }
    // A login form has nothing to rank for; it stays out of every sitemap.
    expect(urls).not.toContain("https://falcon.cricketLeague.com/sign-in")
    expect(urls).toContain("https://falcon.cricketLeague.com/tournaments/00000000-0000-4000-8000-00000000000a")
    expect(urls).toContain("https://falcon.cricketLeague.com/tournaments/00000000-0000-4000-8000-00000000000b")
    expect(urls.every(url => !url.includes("/dashboard") && !url.includes("/api/"))).toBe(true)
    expect(urls).not.toContain("https://ssl.example.com/") // the tenant host never mixes in the platform base
  })

  it("on a TENANT host, robots references that host's own sitemap (Batch 117)", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://ssl.example.com"
    seoMocks.headerValues = { host: "falcon.cricketLeague.com", "x-forwarded-proto": "http" }
    seoMocks.context.mockResolvedValue({ tenantId: "00000000-0000-4000-8000-000000000001", slug: "falcon" })
    const robots = (await load("../app/robots.ts")).default as () => Promise<{ sitemap: string; rules: { allow: string; disallow: string[] }[] }>
    const out = await robots()
    expect(out.sitemap).toBe("http://falcon.cricketLeague.com/sitemap.xml")
    expect(out.rules[0].disallow).toContain("/dashboard")
  })

  it("on the PLATFORM host the sitemap enumerates ONLY routes that exist there — tenant-gated routes would 404 (Batch 117)", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://ssl.example.com/"
    const sitemap = (await load("../app/sitemap.ts")).default as () => Promise<Array<{ url: string }>>
    const urls = (await sitemap()).map(entry => entry.url)
    expect(urls).toContain("https://ssl.example.com/")
    expect(urls).toContain("https://ssl.example.com/hub")
    expect(urls).not.toContain("https://ssl.example.com/sign-in")
    for (const route of ["/tournaments", "/leaderboards", "/hall-of-fame"]) {
      expect(urls).not.toContain(`https://ssl.example.com${route}`)
    }
  })

  it("every sitemap route resolves to an existing page file — a sitemap must never enumerate a dead URL (Batches 113/117)", async () => {
    const fs = await import("node:fs")
    const path = await import("node:path")
    const sitemap = (await load("../app/sitemap.ts")).default as () => Promise<Array<{ url: string }>>
    const root = path.resolve(__dirname, "../app")
    const fileForRoute = (route: string): string => {
      const dynamicTournament = route.match(/^\/tournaments\/([0-9a-f-]{36})$/)
      if (dynamicTournament) return path.join("tournaments", "[id]", "page.tsx")
      const files: Record<string, string> = {
        "/": "page.tsx",
        "/hub": "hub/page.tsx",
        "/leaderboards": "leaderboards/page.tsx",
        "/hall-of-fame": "hall-of-fame/page.tsx",
        "/tournaments": "tournaments/page.tsx",
        "/sign-in": path.join("sign-in", "[[...sign-in]]", "page.tsx"),
      }
      return files[route]
    }
    const scenarios: Array<{ tenantId: string; slug: string } | null> = [
      null,
      { tenantId: "00000000-0000-4000-8000-000000000001", slug: "falcon" },
    ]
    for (const scenario of scenarios) {
      seoMocks.context.mockResolvedValue(scenario)
      if (scenario) {
        seoMocks.headerValues = { host: "falcon.cricketLeague.com", "x-forwarded-proto": "https" }
        seoMocks.tournaments.mockResolvedValue([{ id: "00000000-0000-4000-8000-00000000000a", name: "Falcon Cup" }])
      }
      for (const entry of await sitemap()) {
        const route = new URL(entry.url).pathname
        const file = fileForRoute(route)
        expect(file, `no pinned page file for sitemap route ${route}`).toBeTruthy()
        expect(fs.existsSync(path.join(root, file)), `sitemap route ${route} has no page file ${file}`).toBe(true)
      }
    }
  })

  it("the sitemap falls back to localhost when no base is configured", async () => {
    delete process.env.NEXT_PUBLIC_APP_URL
    delete process.env.WEB_APP_URL
    const sitemap = (await load("../app/sitemap.ts")).default as () => Promise<Array<{ url: string }>>
    expect((await sitemap())[0].url).toBe("http://localhost:3001/")
  })

  it("a tenant read failure falls back to the platform set instead of half-enumerated tenant entries", async () => {
    seoMocks.headerValues = { host: "falcon.cricketLeague.com", "x-forwarded-proto": "https" }
    seoMocks.context.mockResolvedValue({ tenantId: "00000000-0000-4000-8000-000000000001", slug: "falcon" })
    seoMocks.tournaments.mockRejectedValue(new Error("DB down"))
    const sitemap = (await load("../app/sitemap.ts")).default as () => Promise<Array<{ url: string }>>
    const urls = (await sitemap()).map(entry => entry.url)
    expect(urls).toContain("https://falcon.cricketLeague.com/")
    expect(urls.every(url => !url.startsWith("https://falcon.cricketLeague.com/tournaments/00000000"))).toBe(true)
  })

  it("root metadata carries the social graph and a concrete metadataBase", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://ssl.example.com"
    const { buildRootMetadata } = await load("../lib/site-metadata")
    const metadata = buildRootMetadata() as unknown as Record<string, any>
    expect(String(metadata.metadataBase).replace(/\/$/, "")).toBe("https://ssl.example.com")
    expect(metadata.openGraph.title).toBeTruthy()
    expect(metadata.openGraph.type).toBe("website")
    expect(metadata.twitter.card).toBe("summary_large_image")
    expect(metadata.title.template).toContain("%s")
  })

  it("public route metadata carries a per-route canonical, OG and twitter card under the root template (Batch 113)", async () => {
    const { buildPageMetadata } = await load("../lib/site-metadata")
    const meta = buildPageMetadata({
      title: "Public cricket hub",
      description: "Discover published cricket leagues.",
      path: "/hub",
    }) as unknown as Record<string, any>
    expect(meta.title).toBe("Public cricket hub")
    expect(meta.alternates.canonical).toBe("/hub")
    expect(meta.openGraph.url).toBe("/hub")
    expect(meta.openGraph.type).toBe("website")
    expect(meta.twitter.card).toBe("summary_large_image")
  })

  it("the OG image route files exist at the share surfaces (Batch 119)", async () => {
    const fs = await import("node:fs")
    const path = await import("node:path")
    const root = path.resolve(__dirname, "../app")
    // These files are NOT imported here: next/og pulls satori/wasm that the
    // node test environment cannot execute. Their behavior claims live in
    // the match-og-image lib pins; this pins only the convention wiring.
    for (const file of ["opengraph-image.tsx", path.join("matches", "[matchId]", "opengraph-image.tsx")]) {
      expect(fs.existsSync(path.join(root, file)), `missing OG image route ${file}`).toBe(true)
    }
    const matchRoute = fs.readFileSync(path.join(root, "matches", "[matchId]", "opengraph-image.tsx"), "utf8")
    expect(matchRoute).toContain("resolveMatchOgRenderData") // the gates are the same ones the render uses
    expect(matchRoute).toContain("notFound") // hidden match -> no card, not a placeholder
  })

  it("the home page emits Organization and WebSite structured data (Batch 113)", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://ssl.example.com"
    const React = (await import("react")).default
    const { renderToStaticMarkup } = await import("react-dom/server")
    const { StructuredData } = await load("../components/structured-data.tsx")
    const html = renderToStaticMarkup(React.createElement(StructuredData, { organizationName: "Shakir Super League" }))
    expect(html).toContain('type="application/ld+json"')
    expect(html).toContain('"@type":"Organization"')
    expect(html).toContain('"@type":"WebSite"')
    expect(html).toContain("https://ssl.example.com")
    // Batch 128: the caller passes the RESOLVED brand name (the home page
    // reads it per host); the platform name is what it passes on
    // platform-branded hosts.
    expect(html).toContain("Shakir Super League")
  })
})
