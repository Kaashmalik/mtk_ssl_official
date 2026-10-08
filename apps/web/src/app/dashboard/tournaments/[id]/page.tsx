import Link from "next/link"
import { Button } from "@mtk/ui/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@mtk/ui/components/ui/card"
import { Badge } from "@mtk/ui/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@mtk/ui/components/ui/tabs"
import { MotionWrapper } from "@mtk/ui/components/ui/motion-wrapper"
import { ArrowLeft, Users, Edit } from "lucide-react"
import { getTournament, deleteTournament } from "@/app/actions/tournaments"
import { DeleteButton } from "@/components/shared/delete-button"
import { isFollowing, getFollowerCount } from "@/app/actions/follows"
import { FollowButton } from "@/components/shared/follow-button"
import { RegistrationToggle } from "@/components/tournaments/registration-toggle"
import { db, teams, matches, matchInnings, leagueRegistrations } from "@mtk/database"
import { eq, asc, and } from "drizzle-orm"
import { notFound } from "next/navigation"
import { unstable_noStore as noStore } from "next/cache"

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  registration: "Registration Open",
  live: "Live",
  completed: "Completed",
  cancelled: "Cancelled",
}

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-muted text-muted-foreground border-border",
  registration: "bg-info/10 text-info border-info/20",
  live: "bg-live/10 text-live border-live/20",
  completed: "bg-success/10 text-success border-success/20",
  cancelled: "bg-destructive/10 text-destructive border-destructive/20",
}

const FORMAT_LABELS: Record<string, string> = {
  knockout: "Knockout",
  league: "League",
  hybrid: "Hybrid",
  round_robin: "Round Robin",
}

export default async function TournamentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  noStore()
  const { id } = await params
  
  const tournament = await getTournament(id)
  if (!tournament) {
    notFound()
  }

  const followingState = await isFollowing("tournament", id)
  const followersCount = await getFollowerCount("tournament", id)

  // Approved registrations → teams (also include teams.tournamentId for legacy rows)
  const approvedRegs = await db.select().from(leagueRegistrations)
    .where(and(
      eq(leagueRegistrations.tournamentId, id),
      eq(leagueRegistrations.tenantId, tournament.tenantId),
      eq(leagueRegistrations.status, "approved"),
    ))

  const registeredTeamIds = new Set<string>([
    ...approvedRegs.map((r) => r.teamId),
  ])

  const legacyTeams = await db.select().from(teams)
    .where(and(eq(teams.tournamentId, id), eq(teams.tenantId, tournament.tenantId)))
    .orderBy(asc(teams.name))

  for (const t of legacyTeams) registeredTeamIds.add(t.id)

  const registeredTeams = (
    await Promise.all(
      [...registeredTeamIds].map(async (teamId) => {
        const [team] = await db.select().from(teams)
          .where(and(eq(teams.id, teamId), eq(teams.tenantId, tournament.tenantId)))
          .limit(1)
        return team
      }),
    )
  )
    .filter(Boolean)
    .sort((a, b) => a!.name.localeCompare(b!.name)) as typeof legacyTeams

  // Fetch all matches for the tournament
  const tournamentMatchesRaw = await db.select().from(matches)
    .where(eq(matches.tournamentId, id))
    .orderBy(asc(matches.scheduledDate))

  // Fetch match details & team names
  const tournamentMatches = await Promise.all(tournamentMatchesRaw.map(async (m) => {
    const [teamA] = await db.select({ name: teams.name, shortName: teams.shortName }).from(teams).where(eq(teams.id, m.teamAId)).limit(1)
    const [teamB] = await db.select({ name: teams.name, shortName: teams.shortName }).from(teams).where(eq(teams.id, m.teamBId)).limit(1)

    // Fetch innings scores
    const innings = await db.select().from(matchInnings).where(eq(matchInnings.matchId, m.id))
    const teamAInn = innings.find(inn => inn.teamId === m.teamAId)
    const teamBInn = innings.find(inn => inn.teamId === m.teamBId)

    const teamAScore = teamAInn ? `${teamAInn.totalRuns}/${teamAInn.totalWickets}` : "—"
    const teamBScore = teamBInn ? `${teamBInn.totalRuns}/${teamBInn.totalWickets}` : "—"

    const formattedDate = m.scheduledDate 
      ? new Date(m.scheduledDate).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
      : "TBD"

    return {
      ...m,
      teamAName: teamA?.name ?? "TBD Team A",
      teamAShort: teamA?.shortName ?? "TBA",
      teamBName: teamB?.name ?? "TBD Team B",
      teamBShort: teamB?.shortName ?? "TBB",
      teamAScore,
      teamBScore,
      dateText: formattedDate
    }
  }))

  // Calculate points table (standings)
  const completedMatches = tournamentMatchesRaw.filter(m => m.status === "completed")
  const standingsMap = new Map<string, {
    teamId: string
    name: string
    shortName: string
    played: number
    won: number
    lost: number
    noResult: number
    points: number
  }>()

  // Initialize all registered teams with 0 stats
  registeredTeams.forEach(team => {
    standingsMap.set(team.id, {
      teamId: team.id,
      name: team.name,
      shortName: team.shortName || team.name.substring(0, 3).toUpperCase(),
      played: 0,
      won: 0,
      lost: 0,
      noResult: 0,
      points: 0
    })
  })

  // Aggregate stats from completed matches
  completedMatches.forEach(m => {
    const statsA = standingsMap.get(m.teamAId)
    const statsB = standingsMap.get(m.teamBId)

    if (statsA && statsB) {
      statsA.played += 1
      statsB.played += 1

      if (m.winnerId === m.teamAId) {
        statsA.won += 1
        statsB.lost += 1
        statsA.points += 2
      } else if (m.winnerId === m.teamBId) {
        statsB.won += 1
        statsA.lost += 1
        statsB.points += 2
      } else {
        statsA.noResult += 1
        statsB.noResult += 1
        statsA.points += 1
        statsB.points += 1
      }
    }
  })

  // Convert map to array and sort
  const standings = Array.from(standingsMap.values()).sort((a, b) => {
    if (b.points !== a.points) {
      return b.points - a.points
    }
    if (b.won !== a.won) {
      return b.won - a.won
    }
    return a.name.localeCompare(b.name)
  })

  const formattedStartDate = tournament.startDate
    ? new Date(tournament.startDate).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
    : "TBD"

  const formattedEndDate = tournament.endDate
    ? new Date(tournament.endDate).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
    : "TBD"

  const formattedDeadline = tournament.registrationDeadline
    ? new Date(tournament.registrationDeadline).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
    : "TBD"

  return (
    <div className="space-y-6">
      {/* Header */}
      <MotionWrapper variant="fadeInLeft">
        <Link href="/dashboard/tournaments">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-2" />Back
          </Button>
        </Link>
      </MotionWrapper>

      {/* Hero card */}
      <MotionWrapper variant="fadeInUp" delay={0.1}>
        <Card className="overflow-hidden border-none shadow-xl relative text-white">
          <div className="absolute inset-0 z-0 bg-gradient-to-r from-primary via-primary/80 to-indigo-900 opacity-85" />
          <div className="absolute inset-0 z-0 bg-black/10 backdrop-blur-sm" />
          <CardContent className="pt-8 pb-6 relative z-10">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <Badge variant="outline" className="text-xs border-white/30 text-white bg-white/10 backdrop-blur-sm mb-3">
                  {FORMAT_LABELS[tournament.format ?? "league"]}
                </Badge>
                <h1 className="text-3xl font-bold tracking-tight text-white">{tournament.name}</h1>
                <p className="text-sm text-white/70 font-medium mt-1">
                  {formattedStartDate} — {formattedEndDate}
                </p>
              </div>
              <div className="flex gap-2 self-start sm:self-center shrink-0">
                <Badge variant="outline" className={`text-xs border-white/30 text-white bg-white/10 backdrop-blur-sm px-3 py-1.5 font-bold ${STATUS_COLORS[tournament.status ?? "draft"]}`}>
                  {STATUS_LABELS[tournament.status ?? "draft"]}
                </Badge>
                <FollowButton
                  tenantId={tournament.tenantId}
                  followableType="tournament"
                  followableId={id}
                  initialIsFollowing={followingState}
                  initialFollowerCount={followersCount}
                />
                <Link href={`/dashboard/tournaments/${id}/edit`}>
                  <Button variant="outline" size="sm" className="bg-white/10 text-white border-white/30 hover:bg-white/20">
                    <Edit className="h-4 w-4 mr-1" />Edit
                  </Button>
                </Link>
                <RegistrationToggle
                  tournamentId={id}
                  registrationOpen={Boolean(tournament.registrationOpen)}
                />
                <DeleteButton
                  action={deleteTournament}
                  id={id}
                  redirectHref="/dashboard/tournaments"
                  entityLabel="tournament"
                  entityName={tournament.name}
                />
              </div>
            </div>
          </CardContent>
        </Card>
      </MotionWrapper>

      {/* Tabs */}
      <MotionWrapper variant="fadeInUp" delay={0.2}>
        <Tabs defaultValue="overview" className="space-y-4">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="standings">Standings ({standings.length})</TabsTrigger>
            <TabsTrigger value="matches">Matches ({tournamentMatches.length})</TabsTrigger>
            <TabsTrigger value="teams">Teams ({registeredTeams.length})</TabsTrigger>
          </TabsList>

          {/* Overview Tab */}
          <TabsContent value="overview" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Tournament Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                  <div>
                    <span className="text-xs text-muted-foreground block">Format</span>
                    <span className="font-semibold text-sm capitalize">{FORMAT_LABELS[tournament.format ?? "league"]}</span>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground block">Max Teams</span>
                    <span className="font-semibold text-sm">{tournament.maxTeams || "No Limit"}</span>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground block">Registration Status</span>
                    <span className="font-semibold text-sm">{tournament.registrationOpen ? "Open" : "Closed"}</span>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground block">Registration Deadline</span>
                    <span className="font-semibold text-sm">{formattedDeadline}</span>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground block">Start Date</span>
                    <span className="font-semibold text-sm">{formattedStartDate}</span>
                  </div>
                  <div>
                    <span className="text-xs text-muted-foreground block">End Date</span>
                    <span className="font-semibold text-sm">{formattedEndDate}</span>
                  </div>
                </div>

                {tournament.description && (
                  <div className="border-t pt-4">
                    <span className="text-xs text-muted-foreground block mb-1">Description</span>
                    <p className="text-sm text-muted-foreground leading-relaxed">{tournament.description}</p>
                  </div>
                )}

                {tournament.registrationOpen && (
                  <div className="border-t pt-4 flex justify-end">
                    <Link href={`/dashboard/registrations/new?tournamentId=${id}`}>
                      <Button variant="gradient-shine">
                        <Users className="h-4 w-4 mr-2" />Register Your Team
                      </Button>
                    </Link>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Standings Tab */}
          <TabsContent value="standings">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Points Table</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-muted-foreground text-xs">
                        <th className="py-2 text-left font-medium">Pos</th>
                        <th className="py-2 text-left font-medium">Team</th>
                        <th className="py-2 text-center font-medium">P</th>
                        <th className="py-2 text-center font-medium">W</th>
                        <th className="py-2 text-center font-medium">L</th>
                        <th className="py-2 text-center font-medium">NR</th>
                        <th className="py-2 text-center font-medium">Pts</th>
                      </tr>
                    </thead>
                    <tbody>
                      {standings.map((team, idx) => (
                        <tr key={team.teamId} className="border-b last:border-0 hover:bg-muted/20">
                          <td className="py-3 font-semibold text-left tabular-nums text-muted-foreground">{idx + 1}</td>
                          <td className="py-3 font-semibold text-left">
                            <Link href={`/dashboard/teams/${team.teamId}`} className="hover:text-primary transition-colors">
                              {team.name} <span className="text-xs text-muted-foreground">({team.shortName})</span>
                            </Link>
                          </td>
                          <td className="py-3 text-center tabular-nums">{team.played}</td>
                          <td className="py-3 text-center tabular-nums text-success font-medium">{team.won}</td>
                          <td className="py-3 text-center tabular-nums text-destructive">{team.lost}</td>
                          <td className="py-3 text-center tabular-nums text-muted-foreground">{team.noResult}</td>
                          <td className="py-3 text-center tabular-nums font-bold text-primary">{team.points}</td>
                        </tr>
                      ))}
                      {standings.length === 0 && (
                        <tr>
                          <td colSpan={7} className="py-6 text-center text-muted-foreground text-sm">
                            No teams registered or standings generated yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Matches Tab */}
          <TabsContent value="matches">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Matches & Fixtures</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-3">
                  {tournamentMatches.map((m) => (
                    <div key={m.id} className="flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 rounded-xl border bg-card hover:bg-muted/10 transition-colors gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="outline" className={`text-[10px] ${m.status === "completed" ? "bg-success/5 text-success border-success/10" : m.status === "live" ? "bg-live/5 text-live border-live/10 animate-pulse" : "bg-primary/5 text-primary border-primary/10"}`}>
                            {m.status.toUpperCase()}
                          </Badge>
                          <span className="text-[10px] text-muted-foreground font-medium">{m.dateText}</span>
                        </div>
                        <div className="flex items-center gap-4 mt-2">
                          <div className="font-semibold text-sm sm:text-base flex items-center gap-2">
                            <span>{m.teamAName}</span>
                            <span className="text-xs text-muted-foreground tabular-nums">({m.teamAScore})</span>
                          </div>
                          <span className="text-xs text-muted-foreground font-bold">vs</span>
                          <div className="font-semibold text-sm sm:text-base flex items-center gap-2">
                            <span>{m.teamBName}</span>
                            <span className="text-xs text-muted-foreground tabular-nums">({m.teamBScore})</span>
                          </div>
                        </div>
                        {m.result && (
                          <p className="text-xs text-primary font-medium mt-1.5">{m.result}</p>
                        )}
                      </div>
                      <Link href={`/dashboard/matches/${m.id}`} className="shrink-0 self-end sm:self-center">
                        <Button variant="outline" size="sm">Scorecard</Button>
                      </Link>
                    </div>
                  ))}
                  {tournamentMatches.length === 0 && (
                    <div className="py-8 text-center text-muted-foreground text-sm">
                      No matches scheduled for this tournament yet.
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Teams Tab */}
          <TabsContent value="teams">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Registered Teams</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
                  {registeredTeams.map((team) => (
                    <Link key={team.id} href={`/dashboard/teams/${team.id}`}>
                      <Card className="hover:shadow-md hover:-translate-y-0.5 transition-all cursor-pointer">
                        <CardContent className="pt-4 pb-4">
                          <div className="flex items-center gap-3">
                            <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary font-bold text-sm" style={{ borderLeft: `4px solid ${team.primaryColor || "#3B82F6"}` }}>
                              {team.shortName || team.name.substring(0, 3).toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <p className="font-semibold text-sm truncate">{team.name}</p>
                              <p className="text-xs text-muted-foreground mt-0.5">{team.city || "TBD City"}</p>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </Link>
                  ))}
                  {registeredTeams.length === 0 && (
                    <div className="col-span-full py-8 text-center text-muted-foreground text-sm">
                      No teams registered for this tournament yet.
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </MotionWrapper>
    </div>
  )
}
