import type { Metadata } from "next"

/**
 * Batch 112 (SaaS SEO foundation): the ROOT social-graph metadata, extracted
 * from the layout into a font-free module so it is directly pinnable by the
 * SEO contract tests (the layout itself cannot be imported under the node
 * test environment because of next/font ESM coupling).
 */
export function appUrl(): string {
  return (process.env.WEB_APP_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3001").replace(/\/$/, "")
}

export function buildRootMetadata(): Metadata {
  return {
    metadataBase: new URL(appUrl()),
    title: {
      default: "Shakir Super League - Pakistan's #1 Cricket Platform",
      template: "%s | Shakir Super League",
    },
    description: "Modern cricket tournament management platform for leagues across Pakistan and the global diaspora.",
    keywords: ["cricket", "tournament", "league", "Pakistan", "scoring"],
    robots: { index: true, follow: true },
    alternates: { canonical: "/" },
    openGraph: {
      type: "website",
      siteName: "Shakir Super League",
      title: "Shakir Super League - Pakistan's #1 Cricket Platform",
      description: "Modern cricket tournament management platform for leagues across Pakistan and the global diaspora.",
      url: "/",
      locale: "en_PK",
    },
    twitter: {
      card: "summary_large_image",
      title: "Shakir Super League - Pakistan's #1 Cricket Platform",
      description: "Modern cricket tournament management platform for leagues across Pakistan and the global diaspora.",
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
