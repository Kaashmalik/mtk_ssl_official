import Link from "next/link"
import { Button } from "@mtk/ui/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@mtk/ui/components/ui/card"
import { Badge } from "@mtk/ui/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@mtk/ui/components/ui/tabs"
import { MotionWrapper } from "@mtk/ui/components/ui/motion-wrapper"
import { ArrowLeft, Edit, MapPin, TrendingUp } from "lucide-react"
import { getTeamWithRoster, deleteTeam } from "@/app/actions/teams"
import { getPlayers } from "@/app/actions/players"
import { DeleteButton } from "@/components/shared/delete-button"
import { isFollowing, getFollowerCount } from "@/app/actions/follows"
import { FollowButton } from "@/components/shared/follow-button"
import { TeamRosterManager } from "@/components/teams/team-roster-manager"
import { db, matches, teams, matchInnings } from "@mtk/database"
import { eq, and, or, desc } from "drizzle-orm"
import { notFound } from "next/navigation"
import { unstable_noStore as noStore } from "next/cache"

const ROLE_LABELS: Record<string, string> = { 
  batsman: "BAT", 
  bowler: "BOWL", 
  all_rounder: "AR", 
  wicket_keeper: "WK",
  wicket_keeper_batsman: "WK-BAT"
}

export default async function TeamDetailPage({ params }: { params: Promise<{ id: string }> }) {
  noStore()
  const { id } = await params
  
  const team = await getTeamWithRoster(id)
  if (!team) {
    notFound()
  }

  const followingState = await isFollowing("team", id)
  const followersCount = await getFollowerCount("team", id)

  let availablePlayers: { id: string; name: string; teamId: string | null }[] = []
  try {
    const playersResult = await getPlayers({
      page: 1,
      pageSize: 200,
      sortBy: "name",
      sortOrder: "asc",
    })
    availablePlayers = playersResult.data.map((p) => ({
      id: p.id,
      name: p.name,
      teamId: p.teamId ?? null,
    }))
  } catch {
    availablePlayers = team.players.map((p) => ({
      id: p.id,
      name: p.name,
      teamId: id,
    }))
  }

  // Fetch all matches involving this team
  const teamMatches = await db.select().from(matches)
    .where(
      and(
        eq(matches.tenantId, team.tenantId),
        or(eq(matches.teamAId, id), eq(matches.teamBId, id))
      )
    )
    .orderBy(desc(matches.scheduledDate))

  // Resolve match details and opponent details
  const resolvedMatches = await Promise.all(teamMatches.map(async (m) => {
    const oppId = m.teamAId === id ? m.teamBId : m.teamAId
    const [opp] = await db.select({ name: teams.name, shortName: teams.shortName }).from(teams).where(eq(teams.id, oppId)).limit(1)
    const oppName = opp?.name ?? "TBD"

    // Fetch innings scores
    const innings = await db.select().from(matchInnings).where(eq(matchInnings.matchId, m.id))
    const teamInn = innings.find(inn => inn.teamId === id)
    const oppInn = innings.find(inn => inn.teamId === oppId)

    const teamScoreText = teamInn ? `${teamInn.totalRuns}/${teamInn.totalWickets} (${(Math.floor(teamInn.totalBalls / 6) + (teamInn.totalBalls % 6) / 10).toFixed(1)} ov)` : "DNB"
    const oppScoreText = oppInn ? `${oppInn.totalRuns}/${oppInn.totalWickets} (${(Math.floor(oppInn.totalBalls / 6) + (oppInn.totalBalls % 6) / 10).toFixed(1)} ov)` : "DNB"

    let isWin = false
    if (m.status === "completed" && m.winnerId === id) {
      isWin = true
    }

    const formattedDate = m.scheduledDate 
      ? new Date(m.scheduledDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })
      : "TBD"

    return {
      id: m.id,
      vs: oppName,
      score: teamScoreText,
      opScore: oppScoreText,
      result: m.result || (m.status === "live" ? "Live" : m.status.toUpperCase()),
      isWin,
      date: formattedDate,
      status: m.status
    }
  }))

  const completedMatches = resolvedMatches.filter(m => m.status === "completed")
  const playedCount = completedMatches.length
  const winsCount = completedMatches.filter(m => m.isWin).length
  const lossesCount = playedCount - winsCount
  const winRate = playedCount > 0 ? ((winsCount / playedCount) * 100).toFixed(0) : "0"

  const primaryColor = team.primaryColor || "#3B82F6"
  const secondaryColor = team.primaryColor ? `${team.primaryColor}CC` : "#1E3A8A" // 80% opacity fallback
  const shortName = team.shortName || team.name.substring(0, 3).toUpperCase()
  const city = team.city || "TBD City"
  const homeGround = team.homeGround || "TBD Home Ground"
  const foundedYear = team.foundedYear || "TBD"

  return (
    <div className="space-y-6">
      <MotionWrapper variant="fadeInLeft">
        <Link href="/dashboard/teams">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-2" />Back
          </Button>
        </Link>
      </MotionWrapper>

      {/* Hero */}
      <MotionWrapper variant="fadeInUp" delay={0.1}>
        <Card className="overflow-hidden border-none shadow-xl relative text-white">
          <div className="absolute inset-0 z-0" style={{ background: `linear-gradient(135deg, ${primaryColor}, ${secondaryColor})`, opacity: 0.85 }} />
          <div className="absolute inset-0 z-0 bg-black/20 backdrop-blur-md" />
          <CardContent className="pt-8 pb-6 relative z-10">
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6">
              <div className="h-24 w-24 rounded-2xl flex items-center justify-center text-white font-bold text-3xl border-2 border-white/20 shadow-[0_0_20px_rgba(0,0,0,0.3)] shrink-0" style={{ backgroundColor: primaryColor }}>
                {shortName}
              </div>
              <div className="flex-1">
                <h1 className="text-3xl font-bold tracking-tight text-white">{team.name}</h1>
                <div className="flex items-center gap-3 text-sm text-white/70 font-medium mt-2">
                  <span className="flex items-center gap-1">
                    <MapPin className="h-4 w-4 text-white/50" />{city}
                  </span>
                  <span className="h-1 w-1 rounded-full bg-white/30" />
                  <span>{homeGround}</span>
                  <span className="h-1 w-1 rounded-full bg-white/30" />
                  <span>Est. {foundedYear}</span>
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                <FollowButton
                  tenantId={team.tenantId}
                  followableType="team"
                  followableId={id}
                  initialIsFollowing={followingState}
                  initialFollowerCount={followersCount}
                />
<Link href={`/dashboard/teams/${id}/edit`}>
                <Button variant="outline" size="sm">
                  <Edit className="h-4 w-4 mr-1" />Edit
                </Button>
              </Link>
              <Link href={`/dashboard/teams/${id}/analytics`}>
                <Button variant="outline" size="sm">
                  <TrendingUp className="h-4 w-4 mr-1" />Analytics
                </Button>
              </Link>
                <DeleteButton
                  action={deleteTeam}
                  id={id}
                  redirectHref="/dashboard/teams"
                  entityLabel="team"
                  entityName={team.name}
                />
              </div>
            </div>
          </CardContent>
        </Card>
      </MotionWrapper>

      {/* Stats */}
      <MotionWrapper variant="fadeInUp" delay={0.2}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card className="text-center">
            <CardContent className="pt-4 pb-3">
              <p className="text-2xl font-bold">{playedCount}</p>
              <p className="text-xs text-muted-foreground">Played</p>
            </CardContent>
          </Card>
          <Card className="text-center">
            <CardContent className="pt-4 pb-3">
              <p className="text-2xl font-bold text-success">{winsCount}</p>
              <p className="text-xs text-muted-foreground">Won</p>
            </CardContent>
          </Card>
          <Card className="text-center">
            <CardContent className="pt-4 pb-3">
              <p className="text-2xl font-bold text-destructive">{lossesCount}</p>
              <p className="text-xs text-muted-foreground">Lost</p>
            </CardContent>
          </Card>
          <Card className="text-center">
            <CardContent className="pt-4 pb-3">
              <p className="text-2xl font-bold">{winRate}%</p>
              <p className="text-xs text-muted-foreground">Win Rate</p>
            </CardContent>
          </Card>
        </div>
      </MotionWrapper>

      {/* Tabs */}
      <MotionWrapper variant="fadeInUp" delay={0.3}>
        <Tabs defaultValue="squad" className="space-y-4">
          <TabsList>
            <TabsTrigger value="squad">Squad ({team.players.length})</TabsTrigger>
            <TabsTrigger value="matches">Matches ({resolvedMatches.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="squad" className="space-y-4">
            <TeamRosterManager
              teamId={id}
              roster={team.players.map((p) => ({ id: p.id, name: p.name, teamId: id }))}
              availablePlayers={availablePlayers}
            />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {team.players.map((p) => (
                <Link key={p.id} href={`/dashboard/players/${p.id}`}>
                  <Card className="hover:shadow-md hover:-translate-y-0.5 transition-all cursor-pointer">
                    <CardContent className="pt-4 pb-3">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-semibold text-sm">
                          {p.name.charAt(0)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className="font-semibold text-sm truncate">{p.name}</p>
                          </div>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                            <span>#{p.jerseyNumber !== null ? p.jerseyNumber : "—"}</span>
                            <Badge variant="outline" className="text-[10px] h-4 px-1">
                              {p.role ? (ROLE_LABELS[p.role] || p.role.toUpperCase()) : "—"}
                            </Badge>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
              {team.players.length === 0 && (
                <div className="col-span-full py-8 text-center text-muted-foreground text-sm">
                  No players assigned to this squad yet.
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="matches">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Recent Results & Fixtures</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {resolvedMatches.map((m, i) => (
                  <div key={i} className="flex items-center justify-between p-3 rounded-xl bg-muted/20">
                    <div>
                      <p className="font-semibold text-sm">vs {m.vs}</p>
                      <p className="text-xs text-muted-foreground">{m.date}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm tabular-nums">{m.score} — {m.opScore}</p>
                      <Badge variant="outline" className={`text-xs mt-1 ${m.status === "completed" ? (m.isWin ? "text-success border-success/20 bg-success/5" : "text-destructive border-destructive/20 bg-destructive/5") : "text-primary border-primary/20 bg-primary/5"}`}>
                        {m.result}
                      </Badge>
                    </div>
                  </div>
                ))}
                {resolvedMatches.length === 0 && (
                  <div className="py-8 text-center text-muted-foreground text-sm">
                    No match records found for this team.
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </MotionWrapper>
    </div>
  )
}
