import React from "react"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@mtk/ui/components/ui/card"
import { Badge } from "@mtk/ui/components/ui/badge"
import { unstable_noStore as noStore } from "next/cache"
import { Calendar, Trophy } from "lucide-react"
import { requirePublicTenantId } from "@/lib/public-tenant"
import { readPublishedTournaments, type PublicTournament } from "@/lib/public-visibility"
import { buildPageMetadata } from "@/lib/site-metadata"

export const metadata = buildPageMetadata({
  title: "Cricket tournaments",
  description:
    "Published cricket tournaments — draft and cancelled competitions never appear; only what a league has deliberately made public is listed.",
  path: "/tournaments",
})

export const dynamic = "force-dynamic"

const STATUS_LABELS: Record<PublicTournament["status"], string> = {
  draft: "Draft",
  registration: "Registration Open",
  live: "Live",
  completed: "Completed",
  cancelled: "Cancelled",
}

export default async function PublicTournamentsPage() {
  noStore()
  const tenantId = await requirePublicTenantId()
  const tournaments = await readPublishedTournaments(tenantId)

  return (
    <div className="space-y-6 max-w-6xl mx-auto px-4 py-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Published tournaments</h1>
          <p className="text-muted-foreground mt-2 max-w-2xl">
            Competitions published by this league - open standings, live scores and official results.
          </p>
        </div>
        <Link href="/hall-of-fame" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <Trophy className="h-4 w-4" />
          Hall of fame
        </Link>
      </div>
      {!tournaments.length ? (
        <Card>
          <CardHeader><CardTitle className="text-lg">No published tournaments</CardTitle></CardHeader>
          <CardContent className="text-muted-foreground">
            This league has no published competition to show yet. Results and standings will appear here once the organizer
            publishes a tournament.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2">
          {tournaments.map((tournament) => (
            <Link key={tournament.id} href={`/tournaments/${tournament.id}`}>
              <Card className="h-full hover:border-primary/60 transition-colors">
                <CardHeader>
                  <div className="flex items-start justify-between gap-3">
                    <CardTitle className="text-xl">{tournament.name}</CardTitle>
                    <Badge variant={tournament.status === "completed" ? "secondary" : "default"}>
                      {STATUS_LABELS[tournament.status]}
                    </Badge>
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="uppercase tracking-wider">{tournament.format ?? "Custom"}</span>
                    <span>&bull;</span>
                    {(tournament.startDate || tournament.endDate) && (
                      <>
                        <Calendar className="h-3.5 w-3.5" />
                        <span>
                          {(tournament.startDate ?? "TBD") + (tournament.endDate ? ` - ${tournament.endDate}` : "")}
                        </span>
                      </>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {tournament.description ? (
                    <p className="text-sm line-clamp-3 text-muted-foreground">
                      {tournament.description}
                    </p>
                  ) : (
                    <p className="text-sm text-muted-foreground italic">No description yet</p>
                  )}
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Results pending</span>
                    <span className="font-medium text-primary">View tournament &raquo;</span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
