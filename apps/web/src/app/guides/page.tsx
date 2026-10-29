import React from "react"
import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { PublicShell } from "@/components/public/public-shell"
import { JsonLd } from "@/components/json-ld"
import { proseWordCount, readingMinutes } from "@/components/public/prose"
import { GUIDES } from "@/content/guides"
import { appUrl, buildPageMetadata } from "@/lib/site-metadata"

export const metadata = buildPageMetadata({
  title: "Cricket guides for organizers, scorers and players",
  description:
    "Free cricket guides: how to organize a tournament, score a match ball by ball, extras and dismissals explained, net run rate and points tables.",
  path: "/guides",
})

export default function GuidesIndexPage() {
  const base = appUrl()
  const itemList = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Cricket guides",
    itemListElement: GUIDES.map((guide, index) => ({
      "@type": "ListItem",
      position: index + 1,
      url: `${base}/guides/${guide.slug}`,
      name: guide.title,
    })),
  }
  return (
    <PublicShell>
      <JsonLd data={itemList} />
      <main className="container mx-auto max-w-5xl px-6 py-12 lg:py-16">
        <header className="max-w-2xl">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-primary">Guides</p>
          <h1 className="font-display mt-3 text-[clamp(2rem,5vw,3.25rem)] font-extrabold leading-tight tracking-tight">
            Cricket guides for organizers, scorers and players
          </h1>
          <p className="mt-4 text-lg text-muted-foreground">
            Practical, plain-English guides to running competitions and getting the rules right, based on the Laws of Cricket.
          </p>
        </header>
        <ul className="mt-12 grid gap-5 sm:grid-cols-2">
          {GUIDES.map((guide) => (
            <li key={guide.slug}>
              <Link
                href={`/guides/${guide.slug}`}
                className="group flex h-full flex-col rounded-2xl border border-border bg-card p-6 transition-colors hover:border-primary/40"
              >
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">{guide.category}</span>
                <h2 className="mt-3 text-lg font-semibold leading-snug">{guide.title}</h2>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-muted-foreground">{guide.description}</p>
                <span className="mt-4 flex items-center gap-1.5 text-sm font-semibold text-primary">
                  Read guide · {readingMinutes(proseWordCount(guide.body))} min
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" aria-hidden="true" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </main>
    </PublicShell>
  )
}
