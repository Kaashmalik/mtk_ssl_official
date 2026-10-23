import React from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@mtk/ui/components/ui/card"
import { unstable_noStore as noStore } from "next/cache"
import { buildPageMetadata } from "@/lib/site-metadata"
import { readListedHubLeagues } from "@/lib/public-hub"
import { buildHubItemList } from "@/lib/hub-structured-data"
import { JsonLd } from "@/components/json-ld"

export const metadata = buildPageMetadata({
  title: "Public cricket hub",
  description:
    "Discover cricket leagues that have explicitly published themselves: announced competitions and live fixtures only. Unlisted leagues stay private.",
  path: "/hub",
})

/**
 * PUB-02: the cross-league public discovery page — the ONLY page that reads
 * across tenants, and only through `readListedHubLeagues()`, which filters on
 * the shared listing policy and the same publication predicates the single-
 * league pages use. Unlisted leagues are not distinguishable from missing
 * ones (they simply never appear); no unlisted-link tier exists here.
 *
 * Read failures surface an accessible message — the page never crashes and
 * never falls back to an unscoped query.
 */
export default async function HubPage() {
  noStore()

  let read: Awaited<ReturnType<typeof readListedHubLeagues>> | null = null
  let failed = false
  try {
    read = await readListedHubLeagues()
  } catch {
    failed = true
  }

  const hubItemList = failed ? null : buildHubItemList(read)

  return (
    <>
      {/* Batch 118: the platform->league discovery edge as an ItemList —
          only leagues with a verified public host are advertised, and a
          failed/unverifiable read renders NOTHING (never fabricated). */}
      {hubItemList ? <JsonLd data={hubItemList} /> : null}
    <div className="max-w-4xl mx-auto space-y-6 p-4">
      <h1 className="text-2xl font-bold">Public cricket hub</h1>
      <p className="text-sm text-muted-foreground">
        Every league here has explicitly chosen to be publicly discoverable. Only each league&apos;s
        already-published competitions and live fixtures are counted — drafts and cancelled fixtures
        stay invisible, and being listed grants access to nothing else. Leagues without verified
        public domains are shown without links.
      </p>
      {failed && (
        <p role="alert" className="text-destructive">
          The hub could not be loaded. Nothing is exposed while the listing read is unavailable — please try again.
        </p>
      )}
      {read && !read.complete && (
        <p role="note" className="text-sm">
          Showing the first {read.limit} listed leagues alphabetically; more published leagues exist.
        </p>
      )}
      {read && read.leagues.length === 0 && !failed && (
        <p className="text-sm text-muted-foreground">No league has published itself yet.</p>
      )}
      <div className="space-y-4">
        {read?.leagues.map((league) => (
          <Card key={league.tenantId}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">
                {league.url ? (
                  <a href={league.url} className="underline underline-offset-4" rel="noopener noreferrer">
                    {league.name}
                  </a>
                ) : (
                  league.name
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                {league.publishedCompetitions} published {league.publishedCompetitions === 1 ? "competition" : "competitions"}
                {" · "}
                {league.liveMatches} live {league.liveMatches === 1 ? "fixture" : "fixtures"}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
    </>
  )
}
