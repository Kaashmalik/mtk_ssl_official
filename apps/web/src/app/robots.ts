import type { MetadataRoute } from "next"

/**
 * Batch 112 (SaaS SEO foundation): the discoverability contract. Crawlers are
 * admitted to the PUBLIC surfaces and explicitly excluded from every
 * authenticated or operator surface. The sitemap reference uses the same
 * configured base the rest of the app uses for absolute links.
 */
function appUrl(): string {
  return (process.env.WEB_APP_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3001").replace(/\/$/, "")
}

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{
      userAgent: "*",
      allow: "/",
      disallow: ["/dashboard", "/api/", "/settings", "/impersonation", "/broadcast", "/actions"],
    }],
    sitemap: `${appUrl()}/sitemap.xml`,
  }
}
