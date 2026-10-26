import { Card, CardContent } from "@mtk/ui/components/ui/card"
import { Badge } from "@mtk/ui/components/ui/badge"
import { notFound } from "next/navigation"
import { unstable_noStore as noStore } from "next/cache"
import { StreamSelector } from "@/components/live/stream-selector"
import { LiveOverlay } from "@/components/live/live-overlay"
import { MatchChat } from "@/components/live/match-chat"
import { requirePublicTenantId } from "@/lib/public-tenant"
import { readPublishedMatch, readPublishedMatchTeams } from "@/lib/public-visibility"
import { readPublishedMatchPlayback } from "@/lib/broadcast-playback"
import { readPublicChatEnabled } from "@/lib/match-chat"

const STATE_BADGE = {
  live: { label: "LIVE", className: "bg-red-600 text-white" },
  replay: { label: "REPLAY", className: "bg-slate-700 text-white" },
  upcoming: { label: "UPCOMING", className: "bg-amber-600 text-white" },
} as const

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
  const playback = await readPublishedMatchPlayback(tenantId, match)
  const badge = playback.state === "unavailable" ? null : STATE_BADGE[playback.state]
  // ENH-10: chat sits beside the provider video, never on top of it, and only
  // when the league has turned chat on. Its own failures stay inside the panel.
  const chatEnabled = await readPublicChatEnabled(tenantId)

  return (
    <div className={`mx-auto space-y-4 p-4 ${chatEnabled ? "max-w-7xl" : "max-w-5xl"}`}>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">{teamA?.name ?? "Team A"} vs {teamB?.name ?? "Team B"}</h1>
        {badge && <Badge className={badge.className}>{badge.label}</Badge>}
      </div>
      <div className={chatEnabled ? "grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]" : undefined}>
        <div className="min-w-0 space-y-4">
          <StreamSelector catalogue={playback} />
          <Card>
            <CardContent className="py-3">
              <LiveOverlay matchId={matchId} tenantId={tenantId} />
            </CardContent>
          </Card>
        </div>
        {chatEnabled && <MatchChat matchId={matchId} />}
      </div>
    </div>
  )
}
