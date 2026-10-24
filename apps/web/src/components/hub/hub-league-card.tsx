import React from "react"
import { ArrowUpRight } from "lucide-react"
import { Badge } from "@mtk/ui/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@mtk/ui/components/ui/card"

/**
 * Batch 134: one hub league card, extracted so it is directly pinnable
 * and upgraded with ONLY truthful affordances. A league with a verified
 * public domain gets a real visit affordance (same-tab like before, with
 * the safety rel intact). A league WITHOUT one gets an honest on-card
 * chip explaining why nothing is clickable — the intro paragraph said it
 * once, far above the cards; now the card itself answers. The counts line
 * keeps its exact pluralized phrasing.
 */

export function HubLeagueCard({ league }: {
  league: {
    tenantId: string
    name: string
    url: string | null
    publishedCompetitions: number
    liveMatches: number
  }
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">
          {league.url ? (
            <a href={league.url} className="underline underline-offset-4 inline-flex items-center gap-1" rel="noopener noreferrer" aria-label={`Visit league site: ${league.name}`}>
              {league.name}
              <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
            </a>
          ) : (
            <span className="inline-flex items-center gap-2 flex-wrap">
              {league.name}
              <Badge variant="outline" className="text-[10px] font-normal">No public site linked yet</Badge>
            </span>
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
  )
}
