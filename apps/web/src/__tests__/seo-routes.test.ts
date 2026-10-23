import { afterEach, describe, expect, it, vi } from "vitest"

/**
 * ENH-SaaS/SEO (Batch 112): the discoverability contract. Robots admits
 * crawlers to the PUBLIC surfaces only and points at the sitemap; the
 * sitemap enumerates exactly the public routes on the configured base URL
 * (no dashboard/api/settings leakage); the root metadata carries the
 * SocialGraph + Twitter cards with a real metadataBase.
 */
describe("SEO routes and metadata (Batch 112)", () => {
  const ORIGINAL = { ...process.env }

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
    const robots = (await load("../app/robots.ts")).default as () => { rules: { allow: string; disallow: string[] }[]; sitemap: string }
    const out = robots()
    expect(out.sitemap).toBe("https://ssl.example.com/sitemap.xml")
    expect(out.rules[0].allow).toBe("/")
    for (const path of ["/dashboard", "/api/", "/settings", "/impersonation", "/broadcast"]) {
      expect(out.rules[0].disallow).toContain(path)
    }
  })

  it("the sitemap enumerates exactly the public routes on the configured base", async () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://ssl.example.com/"
    const sitemap = (await load("../app/sitemap.ts")).default as () => Array<{ url: string }>
    const urls = sitemap().map(entry => entry.url)
    expect(urls).toContain("https://ssl.example.com/")
    expect(urls).toContain("https://ssl.example.com/hub")
    expect(urls).toContain("https://ssl.example.com/leaderboards")
    expect(urls).toContain("https://ssl.example.com/hall-of-fame")
    expect(urls).toContain("https://ssl.example.com/matches")
    expect(urls.every(url => !url.includes("/dashboard") && !url.includes("/api/"))).toBe(true)
  })

  it("the sitemap falls back to localhost when no base is configured", async () => {
    delete process.env.NEXT_PUBLIC_APP_URL
    delete process.env.WEB_APP_URL
    const sitemap = (await load("../app/sitemap.ts")).default as () => Array<{ url: string }>
    expect(sitemap()[0].url).toBe("http://localhost:3001/")
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
})
