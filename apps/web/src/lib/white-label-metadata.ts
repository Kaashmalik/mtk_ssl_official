import type { Metadata } from "next"
import type { BrandPresentation } from "@/lib/brand-presentation"

/**
 * Batch 115: the white-label metadata layer. The platform-branded root
 * metadata is the SEED; a tenant's own product name and favicon replace the
 * suffix, default title, OpenGraph siteName and icons so every tenant's
 * pages advertise THE TENANT'S brand server-side — crawlers included. The
 * tenant brand is OPTIONAL: `null` (or a brand without an appName) keeps
 * the platform default, and every value is re-sanitized here even though
 * `brandPresentation` already filters at the boundary — the document head
 * is injection-critical, so it defends in depth.
 */

function safeAppName(value: string | undefined): string | null {
  if (typeof value !== "string") return null
  const cleaned = value.replace(/[\u0000-\u001f<>&"']/g, " ").replace(/\s+/g, " ").trim().slice(0, 128)
  return cleaned.length > 0 ? cleaned : null
}

function safeIconUrl(value: string | undefined): string | null {
  if (typeof value !== "string") return null
  try {
    const url = new URL(value)
    return url.protocol === "https:" && !url.username && !url.password ? url.toString() : null
  } catch {
    return null
  }
}

export function buildTenantBrandMetadata(base: Metadata, brand: BrandPresentation | null): Metadata {
  const appName = safeAppName(brand?.appName)
  const icon = safeIconUrl(brand?.faviconUrl)
  if (!appName && !icon) return base

  const branded: Metadata = { ...base }
  if (appName) {
    branded.title = {
      ...(typeof base.title === "object" ? base.title : {}),
      default: `${appName} - Cricket Tournaments, Live Scoring & Standings`,
      template: `%s | ${appName}`,
    }
    branded.openGraph = { ...(base.openGraph ?? {}), siteName: appName }
  }
  if (icon) {
    const previous = base.icons && !Array.isArray(base.icons) ? base.icons : {}
    branded.icons = Object.assign({}, previous, { icon: [{ url: icon }] }) as Metadata["icons"]
  }
  return branded
}
