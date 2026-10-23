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
})
