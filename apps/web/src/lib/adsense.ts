/**
 * Google AdSense configuration. Everything is OFF until the publisher id is
 * configured, so deploying this code changes nothing on its own.
 *
 *   NEXT_PUBLIC_ADSENSE_CLIENT        ca-pub-XXXXXXXXXXXXXXXX (from AdSense)
 *   NEXT_PUBLIC_ADSENSE_SLOT_ARTICLE  optional ad unit id shown after guide articles
 *
 * See docs/ADSENSE_READINESS_2026-10-29.md for the approval runbook.
 */

const CLIENT_PATTERN = /^ca-pub-\d{16}$/
const SLOT_PATTERN = /^\d{6,12}$/

/** The validated `ca-pub-…` client id, or null when ads are not configured. */
export function adsenseClient(): string | null {
  const value = process.env.NEXT_PUBLIC_ADSENSE_CLIENT?.trim()
  return value && CLIENT_PATTERN.test(value) ? value : null
}

/** `pub-…` as ads.txt expects it (the client id without the `ca-` prefix). */
export function adsensePublisherId(): string | null {
  return adsenseClient()?.slice(3) ?? null
}

/** The ad unit id shown after guide articles, or null when not configured. */
export function adsenseArticleSlot(): string | null {
  const value = process.env.NEXT_PUBLIC_ADSENSE_SLOT_ARTICLE?.trim()
  return value && SLOT_PATTERN.test(value) ? value : null
}

/**
 * Ads are for public reading pages only. Never in the product itself: the
 * organizer dashboard, the scorer view (accidental taps on a match-day
 * screen are invalid clicks), broadcast overlays, or auth and invite flows.
 */
const AD_FREE_PREFIXES = [
  "/dashboard",
  "/settings",
  "/broadcast",
  "/sign-in",
  "/sign-up",
  "/verify-otp",
  "/accept-invite",
  "/impersonation",
  "/offline",
]

export function adsAllowedOnPath(pathname: string): boolean {
  if (/^\/matches\/[^/]+\/scoring/.test(pathname)) return false
  return !AD_FREE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
}
