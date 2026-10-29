/**
 * The legal operator of the platform. A white-labelled league shows its own
 * brand name in the chrome, but the service, the privacy policy and the ads
 * are always operated by this entity - so these values never come from
 * tenant branding.
 */
export const OPERATOR = {
  company: "MTK Codex",
  email: "kaash0542@gmail.com",
  city: "Lahore",
  country: "Pakistan",
} as const

/** Shown as "Last updated" on the policy pages; bump when their text changes. */
export const LEGAL_LAST_UPDATED = "2026-10-29"

export function formatLegalDate(isoDate: string): string {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  })
}

/** Public navigation shared by the home page and the public shell. */
export const PUBLIC_NAV = [
  { label: "Guides", href: "/guides" },
  { label: "Hub", href: "/hub" },
  { label: "Tournaments", href: "/tournaments" },
  { label: "Leaderboards", href: "/leaderboards" },
] as const

export const LEGAL_NAV = [
  { label: "About", href: "/about" },
  { label: "Contact", href: "/contact" },
  { label: "Privacy Policy", href: "/privacy" },
  { label: "Terms of Service", href: "/terms" },
] as const
