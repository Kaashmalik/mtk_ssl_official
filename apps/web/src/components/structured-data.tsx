import React from "react"
import { appUrl } from "@/lib/site-metadata"

/**
 * Batch 113: JSON-LD structured data for the public home page —
 * Organization (who runs the platform) and WebSite (what it is), the two
 * types Google's rich-result guidance expects on a product's landing page.
 * Batch 128: the organization name is the SERVER-RESOLVED tenant brand
 * (platform brand as the caller-side fallback) — a branded league's home
 * page must not introduce itself as somebody else's product to crawlers.
 */
export function StructuredData({ organizationName }: { organizationName: string }): React.ReactElement {
  const base = appUrl()
  const organization = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: organizationName,
    url: `${base}/`,
    description:
      "Modern cricket tournament management platform for leagues across Pakistan and the global diaspora.",
  }
  const website = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: organizationName,
    url: base,
  }
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify([organization, website]) }}
    />
  )
}
