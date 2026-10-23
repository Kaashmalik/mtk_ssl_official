import type { MetadataRoute } from "next"
import { headers } from "next/headers"
import { appUrl } from "@/lib/site-metadata"
import { getPublicTenantContext } from "@/lib/public-tenant"

/**
 * The discoverability contract for crawlers (Batch 112 foundation, Batch 117
 * per-host evolution). Crawlers are admitted to the PUBLIC surfaces and
 * explicitly excluded from every authenticated or operator surface.
 *
 * The sitemap reference follows the request: a TENANT host (subdomain or
 * custom domain) points at ITS OWN sitemap, so each white-labelled league's
 * domain is independently discoverable; the platform host points at the
 * configured base. Any resolution failure falls back to the configured base
 * — robots never throws, never fabricates.
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  let sitemapBase = appUrl()
  try {
    const context = await getPublicTenantContext()
    if (context) {
      const headerList = await headers()
      const host = headerList.get("host")
      if (host) {
        sitemapBase = `${headerList.get("x-forwarded-proto") ?? "http"}://${host}`
      }
    }
  } catch {
    /* platform fallback below — robots is lifecycle-critical and never throws */
  }
  return {
    rules: [{
      userAgent: "*",
      allow: "/",
      disallow: ["/dashboard", "/api/", "/settings", "/impersonation", "/broadcast", "/actions"],
    }],
    sitemap: `${sitemapBase}/sitemap.xml`,
  }
}
