import type { MetadataRoute } from "next"

/**
 * Batch 112 (SaaS SEO foundation): exactly the PUBLIC routes. Authenticated
 * surfaces (/dashboard, /api, /settings, operator areas) are deliberately
 * absent — a sitemap must never enumerate pages a crawler cannot see.
 */
function appUrl(): string {
  return (process.env.WEB_APP_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3001").replace(/\/$/, "")
}

export default function sitemap(): MetadataRoute.Sitemap {
  const base = appUrl()
  const now = new Date()
  return ["/", "/hub", "/leaderboards", "/hall-of-fame", "/tournaments", "/sign-in"].map(path => ({
    url: `${base}${path}`,
    lastModified: now,
    changeFrequency: path === "" ? "daily" : "weekly",
    priority: path === "" ? 1 : 0.7,
  }))
}
