import { afterEach, describe, expect, it, vi } from "vitest"

/**
 * Batch 115: the white-label metadata contract. Today EVERY tenant's public
 * pages advertise "Shakir Super League" — the platform's brand — because the
 * root metadata is a hardcoded constant and the tenant branding provider can
 * only patch document.title CLIENT-side, which crawlers never see. A
 * white-label SaaS must render the tenant's own product name and favicon
 * SERVER-side, per host, while keeping every value sanitized and optional:
 * a tenant that never configured branding keeps the platform default.
 */
describe("White-label metadata (Batch 115)", () => {
  afterEach(() => vi.resetModules())

  async function load() {
    vi.resetModules()
    return import("../lib/white-label-metadata")
  }

  function base(): Record<string, any> {
    return {
      metadataBase: new URL("https://ssl.example.com"),
      title: { default: "Shakir Super League - Pakistan's #1 Cricket Platform", template: "%s | Shakir Super League" },
      description: "Modern cricket tournament management platform.",
      openGraph: { siteName: "Shakir Super League", type: "website", title: "Platform title" },
      twitter: { card: "summary_large_image" },
    }
  }

  it("a tenant with no branding keeps the platform default untouched", async () => {
    const { buildTenantBrandMetadata } = await load()
    const out = buildTenantBrandMetadata(base(), null) as unknown as Record<string, any>
    expect(out.title.template).toBe("%s | Shakir Super League")
    expect(out.openGraph.siteName).toBe("Shakir Super League")
  })

  it("a branded tenant's appName replaces the title suffix, default and siteName server-side", async () => {
    const { buildTenantBrandMetadata } = await load()
    const out = buildTenantBrandMetadata(base(), { appName: "Falcon Premier League" }) as unknown as Record<string, any>
    expect(out.title.template).toBe("%s | Falcon Premier League")
    expect(out.title.default).toContain("Falcon Premier League")
    expect(out.openGraph.siteName).toBe("Falcon Premier League")
  })

  it("a validated https favicon overrides the icons server-side", async () => {
    const { buildTenantBrandMetadata } = await load()
    const out = buildTenantBrandMetadata(base(), { appName: "Falcon", faviconUrl: "https://cdn.example.com/falcon.ico" }) as unknown as Record<string, any>
    expect(JSON.stringify(out.icons)).toContain("https://cdn.example.com/falcon.ico")
  })

  it("sanitizes a hostile appName and refuses a non-https favicon — the brand can never inject markup or an insecure asset", async () => {
    const { buildTenantBrandMetadata } = await load()
    const hostile = buildTenantBrandMetadata(base(), { appName: "Evil\u0007<noscript>x</noscript> League" }) as unknown as Record<string, any>
    expect(hostile.title.template).not.toContain("<noscript>")
    expect(hostile.title.template).not.toMatch(/\u0007/)
    const insecure = buildTenantBrandMetadata(base(), { appName: "Falcon", faviconUrl: "http://insecure.example.com/x.ico" } as any) as unknown as Record<string, any>
    expect(JSON.stringify(insecure.icons ?? {})).not.toContain("insecure.example.com")
  })

  it("the PWA manifest stays platform-branded for an unconfigured tenant (Batch 123)", async () => {
    const { buildTenantManifest } = await load()
    const manifest = buildTenantManifest(null) as unknown as Record<string, any>
    expect(manifest.name).toBe("Shakir Super League")
    expect(manifest.short_name).toBe("SSL")
    expect(manifest.theme_color).toBe("#22c55e")
    expect(JSON.stringify(manifest.icons)).toContain("icon-192.png")
  })

  it("a branded tenant's installed PWA carries THE TENANT'S name and theme color (Batch 123)", async () => {
    const { buildTenantManifest } = await load()
    const manifest = buildTenantManifest({ appName: "Falcon Premier League", primaryColor: "#1d4ed8" }) as unknown as Record<string, any>
    expect(manifest.name).toBe("Falcon Premier League")
    expect(manifest.short_name).toBe("Falcon")
    expect(manifest.theme_color).toBe("#1d4ed8")
    // start_url, display, icons stay the platform's — behavior never regresses.
    expect(manifest.start_url).toBe("/dashboard")
    expect(JSON.stringify(manifest.icons)).toContain("icon-192.png")
  })

  it("a hostile theme color never reaches the manifest canvas", async () => {
    const { buildTenantManifest } = await load()
    const manifest = buildTenantManifest({ appName: "Falcon", primaryColor: "expression(alert(1))" }) as unknown as Record<string, any>
    expect(manifest.theme_color).toBe("#22c55e")
  })

  it("resolveBrandName/shortTenantLabel give every visible surface the same sanitized answer (Batch 125)", async () => {
    const { resolveBrandName, shortTenantLabel } = await load()
    expect(resolveBrandName(null)).toBe("Shakir Super League")
    expect(resolveBrandName({ appName: "Falcon Premier League" })).toBe("Falcon Premier League")
    expect(resolveBrandName({ appName: "  Evil\u0007<noscript>x</noscript> " })).not.toMatch(/<noscript>|\u0007/)
    expect(shortTenantLabel(null)).toBe("SSL")
    expect(shortTenantLabel({ appName: "Falcon Premier League" })).toBe("Falcon")
    expect(resolveBrandName({ appName: "   " })).toBe("Shakir Super League")
  })

  it("a branded tenant's apple-web-app label carries the TENANT's short label, not the platform's (Batch 127)", async () => {
    const { buildTenantBrandMetadata } = await load()
    const branded = buildTenantBrandMetadata(base(), { appName: "Falcon Premier League" }) as unknown as Record<string, any>
    expect(branded.appleWebApp?.title).toBe("Falcon")
    // The platform base stays the platform's where no brand applies.
    const plain = buildTenantBrandMetadata(base(), null) as unknown as Record<string, any>
    expect(plain.appleWebApp).toBeUndefined()
  })
})
