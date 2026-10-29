import type { Metadata } from "next"

/**
 * Batch 112 (SaaS SEO foundation): the ROOT social-graph metadata, extracted
 * from the layout into a font-free module so it is directly pinnable by the
 * SEO contract tests (the layout itself cannot be imported under the node
 * test environment because of next/font ESM coupling).
 */
export function appUrl(): string {
  // trim(): a trailing newline pasted into the deploy env once leaked into
  // the JSON-LD as "https://www.cricketleague.tech\n/", an invalid URL.
  return (process.env.WEB_APP_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3001").trim().replace(/\/$/, "")
}

// Google shows ~60 title characters: lead with the brand, then the terms
// people actually search for. (The old "Pakistan's #1" claim was unprovable.)
export const SITE_TITLE = "Shakir Super League – Cricket League App & Live Scoring"

/** Shared search-facing copy: the root description and the home JSON-LD. */
export const SITE_DESCRIPTION =
  "Run your cricket league online: tournaments, fixtures, ball-by-ball live scoring, points tables and player stats. Built for leagues in Pakistan and worldwide."

export function buildRootMetadata(): Metadata {
  return {
    metadataBase: new URL(appUrl()),
    title: {
      default: SITE_TITLE,
      template: "%s | Shakir Super League",
    },
    description: SITE_DESCRIPTION,
    keywords: [
      "cricket league",
      "cricket league management",
      "cricket tournament app",
      "live cricket scoring",
      "cricket scoring app",
      "cricket points table",
      "cricket league Pakistan",
      "Shakir Super League",
    ],
    robots: { index: true, follow: true },
    alternates: { canonical: "/" },
    openGraph: {
      type: "website",
      siteName: "Shakir Super League",
      title: SITE_TITLE,
      description: SITE_DESCRIPTION,
      url: "/",
      locale: "en_PK",
    },
    twitter: {
      card: "summary_large_image",
      title: SITE_TITLE,
      description: SITE_DESCRIPTION,
    },
    manifest: "/manifest.webmanifest",
    appleWebApp: {
      capable: true,
      title: "SSL",
      statusBarStyle: "black-translucent",
    },
    icons: {
      // Raster/vector icons generated from public/icons/logo.svg by
      // scripts/generate-brand-icons.mjs; /favicon.ico (48px-inclusive) is
      // what search engines fetch for their result-page favicon.
      icon: [
        { url: "/favicon.ico", sizes: "48x48" },
        { url: "/icons/logo.svg", type: "image/svg+xml" },
        { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
        { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      ],
      apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
    },
  }
}

/**
 * Batch 113: PER-ROUTE public metadata. The root template appends the site
 * name to the title; each public page contributes only its honest title,
 * description and canonical path so search engines never see duplicated
 * canonicals across the public surfaces.
 */
export function buildPageMetadata(options: { title: string; description: string; path: string }): Metadata {
  return {
    title: options.title,
    description: options.description,
    alternates: { canonical: options.path },
    openGraph: {
      type: "website",
      // Batch 127: siteName is intentionally ABSENT here — a hardcoded
      // platform value in per-route metadata used to override the layout's
      // white-labeled brand on every public page of a branded tenant.
      // Next merges openGraph field-by-field, so the layout's (tenant's)
      // siteName propagates to every route.
      title: options.title,
      description: options.description,
      url: options.path,
    },
    twitter: {
      card: "summary_large_image",
      title: options.title,
      description: options.description,
    },
  }
}
