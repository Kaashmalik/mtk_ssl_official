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
    // Brand first, then the phrases people search for ("cricket league",
    // "live scoring"); social cards carry the same title so a shared link
    // never shows the platform's name on a tenant's site.
    const defaultTitle = `${appName} – Cricket League App & Live Scoring`
    branded.title = {
      ...(typeof base.title === "object" ? base.title : {}),
      default: defaultTitle,
      template: `%s | ${appName}`,
    }
    branded.openGraph = { ...(base.openGraph ?? {}), siteName: appName, title: defaultTitle }
    branded.twitter = { ...(base.twitter ?? {}), title: defaultTitle }
    // Batch 127: the installed iOS web-app label is visible white-label
    // surface too — same short-label rule as the PWA manifest.
    branded.appleWebApp = { ...(typeof base.appleWebApp === "object" ? base.appleWebApp : {}), title: shortTenantLabel(brand) }
  }
  if (icon) {
    const previous = base.icons && !Array.isArray(base.icons) ? base.icons : {}
    branded.icons = Object.assign({}, previous, { icon: [{ url: icon }] }) as Metadata["icons"]
  }
  return branded
}

/**
 * Batch 123: the PWA manifest goes white-label too. The platform manifest
 * (formerly `public/manifest.json`) is the SEED — behavior fields (start_url,
 * scope, display, icons) never change, so no tenant's installed app regresses.
 * A branded tenant's installed app carries THE TENANT'S name and theme color,
 * re-validated here even though `brandPresentation` filters at the boundary —
 * the manifest is render-critical, so it defends in depth exactly like the
 * metadata layer above.
 */

export const PLATFORM_NAME = "Shakir Super League"
const PLATFORM_SHORT_LABEL = "SSL"
const PLATFORM_THEME_COLOR = "#22c55e"

const PLATFORM_MANIFEST = {
  name: PLATFORM_NAME,
  short_name: PLATFORM_SHORT_LABEL,
  description: "Cricket league management and live scoring: tournaments, fixtures, points tables and player stats.",
  start_url: "/dashboard",
  scope: "/",
  display: "standalone",
  orientation: "portrait-primary",
  background_color: "#0a0a0a",
  theme_color: "#22c55e",
  lang: "en",
  dir: "ltr",
  categories: ["sports", "entertainment"],
  icons: [
    { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    { src: "/icons/logo.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
  ],
} as const

function safeThemeColor(value: string | undefined): string {
  return typeof value === "string" && /^#[\da-fA-F]{6}$/.test(value) ? value : PLATFORM_THEME_COLOR
}

/** PWA short-name convention: the longest whole-word prefix fitting 12 chars;
 * a hard cut only when the first word alone exceeds the cap. */
function shortAppName(appName: string): string {
  if (appName.length <= 12) return appName
  const cut = appName.slice(0, 12)
  const spaceIndex = cut.lastIndexOf(" ")
  return spaceIndex >= 4 ? cut.slice(0, spaceIndex) : cut
}

/** Batch 125: the ONE sanitized answer for every VISIBLE brand surface
 * (hero navbar, auth screens, invoices) — the same defend-in-depth
 * sanitization as the metadata layer, platform name as the fallback. */
export function resolveBrandName(brand: { appName?: string | null } | null | undefined): string {
  return safeAppName(brand?.appName ?? undefined) ?? PLATFORM_NAME
}

/** The short label for tight surfaces ("Creating your X account"), computed
 * by the same rule as the PWA short name. */
export function shortTenantLabel(brand: { appName?: string | null } | null | undefined): string {
  const appName = safeAppName(brand?.appName ?? undefined)
  return appName ? shortAppName(appName) : PLATFORM_SHORT_LABEL
}

export function buildTenantManifest(brand: BrandPresentation | null): object {
  const appName = safeAppName(brand?.appName)
  if (!appName) return { ...PLATFORM_MANIFEST }
  return {
    ...PLATFORM_MANIFEST,
    name: appName,
    short_name: shortAppName(appName),
    theme_color: safeThemeColor(brand?.primaryColor),
  }
}
