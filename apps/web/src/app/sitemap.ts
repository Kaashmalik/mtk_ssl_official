import type { MetadataRoute } from "next"
import { headers } from "next/headers"
import { appUrl } from "@/lib/site-metadata"
import { getPublicTenantContext } from "@/lib/public-tenant"
import { readPublishedTournaments } from "@/lib/public-visibility"

/**
 * The sitemap, PER HOST (Batch 117). A sitemap must never enumerate a URL a
 * crawler would 404, so the enumerated set depends on who the request host
 * belongs to:
 *
 * - TENANT host (the white-labelled league's subdomain or custom domain):
 *   the tenant's full public surface — static routes AND one dynamic entry
 *   per PUBLISHED tournament (the same `readPublishedTournaments` gate the
 *   index page uses; drafts/cancels never appear).
 * - PLATFORM host (no tenant): only routes that exist there (`/`, `/hub`,
 *   `/sign-in`) — `/tournaments`, `/leaderboards` and `/hall-of-fame` are
 *   tenant-gated and would 404, so they are deliberately absent.
 * - Any read failure falls back to the platform set; the sitemap never
 *   fabricates entries and never throws.
 */
// /sign-in is deliberately absent: a login form has nothing to rank for and
// spends crawl budget the public pages should get.
const PLATFORM_ROUTES = ["/", "/hub"]
const TENANT_ROUTES = ["/", "/hub", "/leaderboards", "/hall-of-fame", "/tournaments"]

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  let base = appUrl()
  let isTenantHost = false
  let published: Array<{ id: string }> = []

  try {
    const context = await getPublicTenantContext()
    if (context) {
      const headerList = await headers()
      const host = headerList.get("host")
      if (host) {
        isTenantHost = true
        base = `${headerList.get("x-forwarded-proto") ?? "http"}://${host}`
        published = await readPublishedTournaments(context.tenantId)
      }
    }
  } catch {
    isTenantHost = false
    published = []
  }

  // No lastModified: stamping every URL with "now" on each fetch is a
  // signal Google learns to ignore, and there is no real per-page edit time.
  const staticEntries = (isTenantHost ? TENANT_ROUTES : PLATFORM_ROUTES).map(path => ({
    url: `${base}${path}`,
    changeFrequency: (path === "/" ? "daily" : "weekly") as "daily" | "weekly",
    priority: path === "/" ? 1 : 0.7,
  }))
  const tournamentEntries = published.map(tournament => ({
    url: `${base}/tournaments/${tournament.id}`,
    changeFrequency: "daily" as const,
    priority: 0.8,
  }))
  return [...staticEntries, ...tournamentEntries]
}
