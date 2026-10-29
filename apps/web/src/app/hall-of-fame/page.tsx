import React from "react"
import { PublicShell } from "@/components/public/public-shell"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@mtk/ui/components/ui/card"
import { Badge } from "@mtk/ui/components/ui/badge"
import { unstable_noStore as noStore } from "next/cache"
import { Trophy, Calendar } from "lucide-react"
import { requirePublicTenantId } from "@/lib/public-tenant"
import { readPublishedHallOfFame } from "@/lib/public-visibility"
import { buildPageMetadata } from "@/lib/site-metadata"

export const metadata = buildPageMetadata({
  title: "Hall of fame",
  description:
    "Persisted champions of completed, published competitions — written once at completion, never re-derived or guessed.",
  path: "/hall-of-fame",
})

export const dynamic = "force-dynamic"

/**
 * FAN-03 league hall of fame (public, unauthenticated). Lists completed,
 * published competitions with their PERSISTED champion - written once by the
 * completion claim, never re-derived: guessing which old fixture was "really"
 * the final is not a record, so legacy champion-less competitions read absent
 * and the empty state says exactly that.
 */
export default async function PublicHallOfFamePage() {
  noStore()
  const tenantId = await requirePublicTenantId()
  const entries = await readPublishedHallOfFame(tenantId)

  return (
    <PublicShell>
    <div className="space-y-6 max-w-4xl mx-auto px-4 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Hall of fame</h1>
          <p className="text-muted-foreground mt-2 max-w-2xl">
            Champions of this league&apos;s published competitions, recorded exactly as
            claimed at completion. Aggregate record only - no entrant-level detail.
          </p>
        </div>
        <Link href="/tournaments" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <Calendar className="h-4 w-4" />
          Browse tournaments
        </Link>
      </div>
      {!entries.length ? (
        <Card>
          <CardHeader><CardTitle className="text-lg">No champions recorded</CardTitle></CardHeader>
          <CardContent className="text-muted-foreground">
            A champion is written once a competition completes. Legacy competitions that
            finished without a recorded champion are intentionally absent - records are
            never guessed.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {entries.map((entry) => (
            <Link key={entry.tournamentId} href={`/tournaments/${entry.tournamentId}`}>
              <Card className="hover:border-primary/60 transition-colors">
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <CardTitle className="text-xl">{entry.name}</CardTitle>
                    <Badge variant="secondary" className="gap-1.5">
                      <Trophy className="h-3.5 w-3.5" />
                      Champion
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="font-medium">{entry.championTeamName}</span>
                  <span className="text-muted-foreground text-xs">
                    {entry.completedAt ? `Recorded ${entry.completedAt.slice(0, 10)}` : ""}
                  </span>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
    </PublicShell>
  )
}
