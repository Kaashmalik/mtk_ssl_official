import React from "react"
import { appUrl } from "@/lib/site-metadata"

/**
 * Batch 113: JSON-LD structured data for the public home page —
 * Organization (who runs the platform) and WebSite (what it is), the two
 * types Google's rich-result guidance expects on a product's landing page.
 * The values are truthful constants: the platform name and the configured
 * base URL, nothing fabricated.
 */
export function StructuredData(): React.ReactElement {
  const base = appUrl()
  const organization = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Shakir Super League",
    url: `${base}/`,
    description:
      "Modern cricket tournament management platform for leagues across Pakistan and the global diaspora.",
  }
  const website = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "Shakir Super League",
    url: base,
  }
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify([organization, website]) }}
    />
  )
}
