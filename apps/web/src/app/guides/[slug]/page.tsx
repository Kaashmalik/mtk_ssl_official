import React from "react"
import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowRight, ChevronRight } from "lucide-react"
import { PublicShell } from "@/components/public/public-shell"
import { JsonLd } from "@/components/json-ld"
import { Prose, headingId, proseWordCount, readingMinutes } from "@/components/public/prose"
import { AdSlot } from "@/components/ads/adsense"
import { GUIDES, getGuide } from "@/content/guides"
import { adsenseArticleSlot, adsenseClient } from "@/lib/adsense"
import { OPERATOR, formatLegalDate } from "@/lib/legal"
import { appUrl, buildPageMetadata } from "@/lib/site-metadata"

// Guides are static content: prerendered at build, unknown slugs are a real 404.
export const dynamicParams = false

export function generateStaticParams() {
  return GUIDES.map((guide) => ({ slug: guide.slug }))
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const guide = getGuide((await params).slug)
  if (!guide) return {}
  const base = buildPageMetadata({ title: guide.title, description: guide.description, path: `/guides/${guide.slug}` })
  return {
    ...base,
    openGraph: {
      ...base.openGraph,
      type: "article",
      publishedTime: guide.publishedAt,
      modifiedTime: guide.updatedAt,
      section: guide.category,
    },
  }
}

export default async function GuidePage({ params }: { params: Promise<{ slug: string }> }) {
  const guide = getGuide((await params).slug)
  if (!guide) notFound()

  const base = appUrl()
  const url = `${base}/guides/${guide.slug}`
  const minutes = readingMinutes(proseWordCount(guide.body))
  const toc = guide.body.flatMap((block) => (block.type === "h2" ? [{ id: headingId(block), text: block.text }] : []))
  const related = guide.related.flatMap((slug) => {
    const match = getGuide(slug)
    return match ? [match] : []
  })

  const article = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: guide.title,
    description: guide.description,
    datePublished: guide.publishedAt,
    dateModified: guide.updatedAt,
    mainEntityOfPage: url,
    url,
    articleSection: guide.category,
    author: { "@type": "Organization", name: OPERATOR.company, url: `${base}/about` },
    publisher: { "@type": "Organization", name: OPERATOR.company, logo: { "@type": "ImageObject", url: `${base}/icons/icon-512.png` } },
    image: `${base}/opengraph-image`,
  }
  const breadcrumbs = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${base}/` },
      { "@type": "ListItem", position: 2, name: "Guides", item: `${base}/guides` },
      { "@type": "ListItem", position: 3, name: guide.title, item: url },
    ],
  }

  return (
    <PublicShell>
      <JsonLd data={[article, breadcrumbs]} />
      <main className="container mx-auto max-w-6xl px-6 py-10 lg:py-14">
        <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
          <ol className="flex flex-wrap items-center gap-1.5">
            <li><Link href="/" className="hover:text-foreground">Home</Link></li>
            <li aria-hidden="true"><ChevronRight className="h-3.5 w-3.5" /></li>
            <li><Link href="/guides" className="hover:text-foreground">Guides</Link></li>
            <li aria-hidden="true"><ChevronRight className="h-3.5 w-3.5" /></li>
            <li aria-current="page" className="truncate text-foreground">{guide.category}</li>
          </ol>
        </nav>

        <div className="mt-8 grid gap-12 lg:grid-cols-[minmax(0,1fr)_260px]">
          <article className="min-w-0 max-w-3xl">
            <header>
              <p className="text-sm font-semibold uppercase tracking-[0.16em] text-primary">{guide.category}</p>
              <h1 className="font-display mt-3 text-[clamp(2rem,4.5vw,3rem)] font-extrabold leading-tight tracking-tight text-balance">
                {guide.title}
              </h1>
              <p className="mt-4 text-lg text-muted-foreground">{guide.description}</p>
              <p className="mt-5 text-sm text-muted-foreground">
                By {OPERATOR.company} · Updated <time dateTime={guide.updatedAt}>{formatLegalDate(guide.updatedAt)}</time> · {minutes} min read
              </p>
            </header>
            <div className="mt-10">
              <Prose blocks={guide.body} />
            </div>

            <AdSlot client={adsenseClient()} slot={adsenseArticleSlot()} />

            <section aria-labelledby="cta-heading" className="mt-12 rounded-2xl bg-primary px-6 py-8 text-primary-foreground">
              <h2 id="cta-heading" className="font-display text-2xl font-bold">Run your league with live scoring</h2>
              <p className="mt-2 max-w-xl text-primary-foreground/85">
                Fixtures, ball-by-ball scoring, automatic points tables and player stats in one place.
              </p>
              <Link
                href="/"
                className="mt-5 inline-flex items-center gap-1.5 rounded-xl bg-background px-5 py-2.5 text-sm font-semibold text-foreground hover:bg-background/90"
              >
                See how it works <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </section>
          </article>

          <aside className="hidden lg:block">
            <nav aria-label="On this page" className="sticky top-24 space-y-3 text-sm">
              <p className="font-semibold">On this page</p>
              <ul className="space-y-2 border-s border-border ps-4 text-muted-foreground">
                {toc.map((item) => (
                  <li key={item.id}>
                    <a href={`#${item.id}`} className="hover:text-foreground">{item.text}</a>
                  </li>
                ))}
              </ul>
            </nav>
          </aside>
        </div>

        {related.length > 0 && (
          <section aria-labelledby="related-heading" className="mt-16 border-t border-border pt-10">
            <h2 id="related-heading" className="font-display text-2xl font-bold">Related guides</h2>
            <ul className="mt-6 grid gap-4 md:grid-cols-3">
              {related.map((item) => (
                <li key={item.slug}>
                  <Link
                    href={`/guides/${item.slug}`}
                    className="flex h-full flex-col rounded-2xl border border-border bg-card p-5 transition-colors hover:border-primary/40"
                  >
                    <span className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">{item.category}</span>
                    <span className="mt-2 font-semibold leading-snug">{item.title}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </PublicShell>
  )
}
