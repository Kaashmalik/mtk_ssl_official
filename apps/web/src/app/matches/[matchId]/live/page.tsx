import { Card, CardContent } from "@mtk/ui/components/ui/card"
import { Badge } from "@mtk/ui/components/ui/badge"
import { notFound } from "next/navigation"
import { unstable_noStore as noStore } from "next/cache"
import { StreamSelector } from "@/components/live/stream-selector"
import { LiveOverlay } from "@/components/live/live-overlay"
import { requirePublicTenantId } from "@/lib/public-tenant"
import { readPublishedMatch, readPublishedMatchTeams } from "@/lib/public-visibility"

export default async function LiveMatchPage({ params }: { params: Promise<{ matchId: string }> }) {
  noStore()
  const { matchId } = await params

  // Tenant-scoped AND publication-gated: this route is unauthenticated, so the
  // match (and therefore the stream URL below) must be proven to belong to the
  // request's tenant and be published. A cancelled/draft fixture 404s.
  const tenantId = await requirePublicTenantId()
  const match = await readPublishedMatch(tenantId, matchId)
  if (!match) notFound()
  const { teamA, teamB } = await readPublishedMatchTeams(tenantId, match)

  return (
    <div className="max-w-5xl mx-auto space-y-4 p-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">{teamA?.name ?? "Team A"} vs {teamB?.name ?? "Team B"}</h1>
        {match.streamStatus === "live" && <Badge className="bg-red-600 text-white">LIVE</Badge>}
      </div>
      <StreamSelector source={match.streamSource} url={match.liveStreamUrl} />
      <Card>
        <CardContent className="py-3">
          <LiveOverlay matchId={matchId} tenantId={tenantId} />
        </CardContent>
      </Card>
    </div>
  )
}
