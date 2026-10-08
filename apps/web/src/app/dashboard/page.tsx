import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"
import Link from "next/link"
import { Suspense } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@mtk/ui/components/ui/card"
import { Button } from "@mtk/ui/components/ui/button"
import { StatCard } from "@mtk/ui/components/ui/stat-card"
import { Skeleton } from "@mtk/ui/components/ui/skeleton"
import { MotionWrapper } from "@mtk/ui/components/ui/motion-wrapper"
import { Badge } from "@mtk/ui/components/ui/badge"
import { Plus, Trophy, Users, CalendarDays, ArrowRight, Sword, TrendingUp, Zap, Clock, Inbox } from "lucide-react"
import { getMyTenant } from "@/app/actions/tenants"
import { db, teams, players, tournaments, matches, matchInnings } from "@mtk/database"
import { eq, count, and, desc, inArray } from "drizzle-orm"
import { unstable_noStore as noStore } from "next/cache"

// ─── Data Fetching Helpers ────────────────────────────────────

async function getDashboardStats(tenantId: string) {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const { lt } = await import("drizzle-orm")

    const [
      [{ totalTeams }],
      [{ totalPlayers }],
      [{ totalTournaments }],
      [{ totalMatches }],
      [{ activeMatches }],
      [{ previousTeams }],
      [{ previousPlayers }],
      [{ previousTournaments }],
      [{ previousMatches }],
    ] = await Promise.all([
      db.select({ totalTeams: count() }).from(teams).where(eq(teams.tenantId, tenantId)),
      db.select({ totalPlayers: count() }).from(players).where(eq(players.tenantId, tenantId)),
      db.select({ totalTournaments: count() }).from(tournaments).where(eq(tournaments.tenantId, tenantId)),
      db.select({ totalMatches: count() }).from(matches).where(eq(matches.tenantId, tenantId)),
      db.select({ activeMatches: count() }).from(matches).where(and(eq(matches.tenantId, tenantId), eq(matches.status, "live"))),
      db.select({ previousTeams: count() }).from(teams).where(and(eq(teams.tenantId, tenantId), lt(teams.createdAt, thirtyDaysAgo))),
      db.select({ previousPlayers: count() }).from(players).where(and(eq(players.tenantId, tenantId), lt(players.createdAt, thirtyDaysAgo))),
      db.select({ previousTournaments: count() }).from(tournaments).where(and(eq(tournaments.tenantId, tenantId), lt(tournaments.createdAt, thirtyDaysAgo))),
      db.select({ previousMatches: count() }).from(matches).where(and(eq(matches.tenantId, tenantId), lt(matches.createdAt, thirtyDaysAgo))),
    ])

    return {
      totalTeams: Number(totalTeams),
      totalPlayers: Number(totalPlayers),
      totalTournaments: Number(totalTournaments),
      totalMatches: Number(totalMatches),
      activeMatches: Number(activeMatches),
      previousTeams: Number(previousTeams),
      previousPlayers: Number(previousPlayers),
      previousTournaments: Number(previousTournaments),
      previousMatches: Number(previousMatches),
    }
  } catch (error) {
    console.error("Failed to fetch dashboard stats:", error)
    return {
      totalTeams: 0, totalPlayers: 0, totalTournaments: 0, totalMatches: 0, activeMatches: 0,
      previousTeams: 0, previousPlayers: 0, previousTournaments: 0, previousMatches: 0,
    }
  }
}

/**
 * Batch-fetch team names by IDs in a single query (eliminates N+1 problem).
 */
async function getTeamNameMap(teamIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  const uniqueIds = [...new Set(teamIds.filter(Boolean))]
  if (uniqueIds.length === 0) return map

  try {
    const { inArray } = await import("drizzle-orm")
    const rows = await db
      .select({ id: teams.id, name: teams.name })
      .from(teams)
      .where(inArray(teams.id, uniqueIds))
    for (const row of rows) {
      map.set(row.id, row.name)
    }
  } catch (error) {
    console.error("Failed to batch-fetch team names:", error)
  }
  return map
}

async function getInningsForMatches(matchIds: string[]) {
  if (matchIds.length === 0) return new Map<string, typeof matchInnings.$inferSelect[]>()
  try {
    const { inArray } = await import("drizzle-orm")
    const rows = await db.select().from(matchInnings)
      .where(inArray(matchInnings.matchId, matchIds))
      .orderBy(matchInnings.inningsNumber)
    const map = new Map<string, typeof rows>()
    for (const row of rows) {
      const existing = map.get(row.matchId) || []
      existing.push(row)
      map.set(row.matchId, existing)
    }
    return map
  } catch {
    return new Map<string, typeof matchInnings.$inferSelect[]>()
  }
}

async function getLiveMatches(tenantId: string) {
  try {
    const liveMatchesRaw = await db.select().from(matches)
      .where(and(eq(matches.tenantId, tenantId), eq(matches.status, "live")))
      .limit(5)

    // Batch fetch all team names + innings in 2 queries instead of N+1
    const allTeamIds = liveMatchesRaw.flatMap(m => [m.teamAId, m.teamBId])
    const [teamNames, inningsMap] = await Promise.all([
      getTeamNameMap(allTeamIds),
      getInningsForMatches(liveMatchesRaw.map(m => m.id)),
    ])

    return liveMatchesRaw.map((m) => {
      const teamAName = teamNames.get(m.teamAId) ?? "TBD"
      const teamBName = teamNames.get(m.teamBId) ?? "TBD"
      const innings = inningsMap.get(m.id) || []
      const inn1 = innings.find((i) => i.inningsNumber === 1)
      const inn2 = innings.find((i) => i.inningsNumber === 2)
      const formatScore = (inn: typeof inn1) =>
        inn ? `${inn.totalRuns}/${inn.totalWickets}` : "—"
      const formatOvers = (inn: typeof inn1) =>
        inn ? `${Math.floor(inn.totalBalls / 6)}.${inn.totalBalls % 6}` : "0.0"

      return {
        id: m.id,
        team1: teamAName,
        team2: teamBName,
        score1: formatScore(inn1),
        score2: formatScore(inn2),
        overs2: formatOvers(inn2),
        target: inn1 ? inn1.totalRuns + 1 : 0,
      }
    })
  } catch (error) {
    console.error("Failed to fetch live matches:", error)
    return []
  }
}

async function getUpcomingMatches(tenantId: string) {
  try {
    const upcomingRaw = await db.select().from(matches)
      .where(and(eq(matches.tenantId, tenantId), eq(matches.status, "scheduled")))
      .orderBy(matches.scheduledDate)
      .limit(5)

    // Batch fetch team names in 1 query
    const allTeamIds = upcomingRaw.flatMap(m => [m.teamAId, m.teamBId])
    const teamNames = await getTeamNameMap(allTeamIds)

    return upcomingRaw.map((m) => ({
      id: m.id,
      team1: teamNames.get(m.teamAId) ?? "TBD",
      team2: teamNames.get(m.teamBId) ?? "TBD",
      time: m.scheduledDate
        ? new Intl.DateTimeFormat("en-PK", { dateStyle: "medium", timeStyle: "short" }).format(new Date(m.scheduledDate))
        : "TBD",
      venue: "", // venue name lookup could be added later
    }))
  } catch (error) {
    console.error("Failed to fetch upcoming matches:", error)
    return []
  }
}

async function getRecentActivity(tenantId: string) {
  try {
    const recentMatches = await db.select().from(matches)
      .where(and(eq(matches.tenantId, tenantId), eq(matches.status, "completed")))
      .orderBy(desc(matches.updatedAt))
      .limit(5)

    // Batch fetch team names in 1 query
    const allTeamIds = recentMatches.flatMap(m => [m.teamAId, m.teamBId])
    const teamNames = await getTeamNameMap(allTeamIds)

    return recentMatches.map((m) => {
      const teamAName = teamNames.get(m.teamAId) ?? "TBD"
      const teamBName = teamNames.get(m.teamBId) ?? "TBD"
      const message = m.result ?? `${teamAName} vs ${teamBName} completed`
      const timeAgo = getRelativeTime(m.updatedAt)
      return { type: "match" as const, message, time: timeAgo }
    })
  } catch (error) {
    console.error("Failed to fetch recent activity:", error)
    return []
  }
}

function getRelativeTime(date: Date): string {
  const now = Date.now()
  const diff = now - date.getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return "Just now"
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours > 1 ? "s" : ""} ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days > 1 ? "s" : ""} ago`
}

// ─── Components ───────────────────────────────────────────────

async function DashboardStats({ tenantId }: { tenantId: string }) {
  const stats = await getDashboardStats(tenantId)

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" role="region" aria-label="Dashboard Statistics">
      <StatCard
        title="Total Teams"
        value={stats.totalTeams}
        previousValue={stats.previousTeams}
        trendLabel="new this month"
        icon={<Users className="h-full w-full" />}
        accentColor="oklch(0.6 0.16 145)"
        delay={0}
      />
      <StatCard
        title="Active Players"
        value={stats.totalPlayers}
        previousValue={stats.previousPlayers}
        trendLabel="new this month"
        icon={<Sword className="h-full w-full" />}
        accentColor="oklch(0.6 0.15 240)"
        delay={1}
      />
      <StatCard
        title="Tournaments"
        value={stats.totalTournaments}
        previousValue={stats.previousTournaments}
        trendLabel="new this month"
        icon={<Trophy className="h-full w-full" />}
        accentColor="oklch(0.7 0.15 80)"
        delay={2}
      />
      <StatCard
        title="Total Matches"
        value={stats.totalMatches}
        previousValue={stats.previousMatches}
        trendLabel="new this month"
        icon={<CalendarDays className="h-full w-full" />}
        accentColor="oklch(0.65 0.2 300)"
        delay={3}
      />
    </div>
  )
}

function StatsLoading() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="rounded-2xl border bg-card p-6">
          <Skeleton className="h-4 w-24 mb-4" />
          <Skeleton className="h-8 w-16 mb-2" />
          <Skeleton className="h-3 w-32" />
        </div>
      ))}
    </div>
  )
}

// Live Matches Section
async function LiveMatchesBanner({ tenantId }: { tenantId: string }) {
  const liveMatches = await getLiveMatches(tenantId)

  if (liveMatches.length === 0) return null

  return (
    <MotionWrapper variant="fadeInUp" delay={0.2}>
      <Card className="border-live/20 bg-linear-to-r from-live/5 via-transparent to-live/5 overflow-hidden relative shadow-[0_0_20px_-5px_var(--color-live)]">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,var(--color-live)_0%,transparent_70%)] opacity-10 mix-blend-screen pointer-events-none" />
        <div className="absolute top-0 left-0 w-full h-1 bg-linear-to-r from-live via-live/80 to-transparent" />
        <CardHeader className="pb-3 relative z-10">
          <div className="flex items-center gap-2">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-live opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-live shadow-[0_0_10px_var(--color-live)]" />
            </span>
            <CardTitle className="text-base font-semibold">Live Now</CardTitle>
            <Badge variant="outline" className="text-live border-live/30 text-xs">
              {liveMatches.length} match{liveMatches.length > 1 ? "es" : ""}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {liveMatches.map((match) => (
              <Link key={match.id} href={`/dashboard/matches/${match.id}`} className="block">
                <div className="flex items-center justify-between p-3 rounded-xl bg-card/50 hover:bg-card transition-colors">
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-semibold text-sm">{match.team1}</span>
                      <span className="font-bold text-base tabular-nums">{match.score1}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-sm">{match.team2}</span>
                      <span className="font-bold text-base tabular-nums">{match.score2}</span>
                    </div>
                    {match.target > 0 && match.score2 !== "—" && (
                      <p className="text-xs text-muted-foreground mt-1">
                        {match.team2} need {Math.max(0, match.target - parseInt(match.score2))} runs
                      </p>
                    )}
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground ml-4" />
                </div>
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>
    </MotionWrapper>
  )
}

// Quick Actions Section
function QuickActions() {
  const actions = [
    { label: "Create Tournament", description: "Set up a new league or knockout", href: "/dashboard/tournaments/new", icon: Trophy, color: "text-primary" },
    { label: "Register Team", description: "Add a new team to your league", href: "/dashboard/teams/new", icon: Users, color: "text-info" },
    { label: "Add Player", description: "Create player profile", href: "/dashboard/players/new", icon: Sword, color: "text-success" },
    { label: "Schedule Match", description: "Create a fixture", href: "/dashboard/matches/new", icon: CalendarDays, color: "text-warning" },
  ]

  return (
    <Card className="glass-panel-subtle border-none">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-primary" />
          <CardTitle className="text-base">Quick Actions</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {actions.map((action) => (
          <Button key={action.href} variant="outline" className="w-full justify-start h-auto py-3 text-left group" asChild>
            <Link href={action.href}>
              <div className="flex items-center w-full">
                <div className={`p-2 rounded-xl mr-3 bg-muted/50 ${action.color} group-hover:bg-primary/10 transition-colors`}>
                  <action.icon className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="font-semibold block text-sm">{action.label}</span>
                  <span className="text-xs text-muted-foreground">{action.description}</span>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground ml-2 opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>
            </Link>
          </Button>
        ))}
      </CardContent>
    </Card>
  )
}

/* Points Table Widget — league-format tournament standings */
async function PointsTableWidget({ tenantId }: { tenantId: string }) {
  const rows = await getPointsTable(tenantId)
  if (!rows) return null

  return (
    <Card className="glass-panel-subtle border-none">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Trophy className="h-4 w-4 text-warning" />
            <CardTitle className="text-base">Points Table</CardTitle>
          </div>
          <Link href={`/tournaments/${rows.tournamentId}`}>
            <Button variant="link" size="sm" className="text-xs h-auto p-0">Full table</Button>
          </Link>
        </div>
        <p className="text-xs text-muted-foreground">{rows.tournamentName}</p>
      </CardHeader>
      <CardContent>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-muted-foreground text-xs">
              <th className="py-1.5 text-left font-medium w-6">#</th>
              <th className="py-1.5 text-left font-medium">Team</th>
              <th className="py-1.5 text-center font-medium">P</th>
              <th className="py-1.5 text-center font-medium">W</th>
              <th className="py-1.5 text-center font-medium">L</th>
              <th className="py-1.5 text-center font-medium">Pts</th>
            </tr>
          </thead>
          <tbody>
            {rows.standings.map((s, i) => (
              <tr key={s.teamId} className="border-b last:border-0">
                <td className="py-1.5 text-muted-foreground">{i + 1}</td>
                <td className="py-1.5 font-medium truncate">{s.name}</td>
                <td className="py-1.5 text-center tabular-nums">{s.played}</td>
                <td className="py-1.5 text-center tabular-nums">{s.won}</td>
                <td className="py-1.5 text-center tabular-nums">{s.lost}</td>
                <td className="py-1.5 text-center tabular-nums font-semibold">{s.points}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  )
}

/* Upcoming Matches Timeline */
/**
 * Points table for the most recent league-format (non-knockout) tournament.
 * Returns null when there is nothing meaningful to show.
 */
async function getPointsTable(tenantId: string) {
  try {
    const leagueTournaments = await db.select().from(tournaments)
      .where(and(eq(tournaments.tenantId, tenantId), inArray(tournaments.format, ["league", "round_robin", "hybrid"])))
      .orderBy(desc(tournaments.createdAt))
      .limit(1)

    const tournament = leagueTournaments[0]
    if (!tournament) return null

    const tournamentMatches = await db.select().from(matches)
      .where(and(eq(matches.tenantId, tenantId), eq(matches.tournamentId, tournament.id)))

    const teamIds = Array.from(new Set(tournamentMatches.flatMap((m) => [m.teamAId, m.teamBId])))
    if (teamIds.length === 0) return null

    const teamRows = await db.select({ id: teams.id, name: teams.name }).from(teams)
      .where(and(eq(teams.tenantId, tenantId), inArray(teams.id, teamIds)))

    const table = new Map<string, { teamId: string; name: string; played: number; won: number; lost: number; points: number }>()
    for (const t of teamRows) {
      table.set(t.id, { teamId: t.id, name: t.name, played: 0, won: 0, lost: 0, points: 0 })
    }

    for (const m of tournamentMatches) {
      if (m.status !== "completed") continue
      const a = table.get(m.teamAId)
      const b = table.get(m.teamBId)
      if (!a || !b) continue
      a.played++; b.played++
      if (m.winnerId === m.teamAId) { a.won++; a.points += 2; b.lost++ }
      else if (m.winnerId === m.teamBId) { b.won++; b.points += 2; a.lost++ }
      else { a.points += 1; b.points += 1 }
    }

    const standings = [...table.values()].sort((a, b) => b.points - a.points || b.won - a.won)
    if (standings.length === 0) return null

    return { tournamentId: tournament.id, tournamentName: tournament.name, standings }
  } catch (error) {
    console.error("Failed to fetch points table:", error)
    return null
  }
}

async function UpcomingMatchesSection({ tenantId }: { tenantId: string }) {
  const upcoming = await getUpcomingMatches(tenantId)

  return (
    <Card className="glass-panel-subtle border-none">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-info" />
          <CardTitle className="text-base">Upcoming Matches</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        {upcoming.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-6 text-center">
            <CalendarDays className="h-8 w-8 text-muted-foreground/40 mb-2" />
            <p className="text-sm text-muted-foreground">No upcoming matches scheduled</p>
            <Link href="/dashboard/matches/new">
              <Button variant="link" size="sm" className="mt-1 text-xs">Schedule a match</Button>
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {upcoming.map((match, i) => (
              <MotionWrapper key={match.id} variant="fadeInRight" delay={i * 0.1}>
                <div className="flex items-start gap-3 relative group">
                  <div className="absolute left-[3px] top-4 -bottom-4 w-px bg-border group-last:hidden" />
                  <div className="h-2 w-2 rounded-full bg-info/60 mt-1.5 shrink-0 relative z-10 ring-4 ring-background group-hover:bg-info transition-colors" />
                  <div className="flex-1 pb-2">
                    <p className="font-medium text-sm">{match.team1} <span className="text-muted-foreground text-xs mx-1">vs</span> {match.team2}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge variant="outline" className="text-[10px] font-normal bg-card/50">{match.time}</Badge>
                    </div>
                  </div>
                </div>
              </MotionWrapper>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// Recent Activity Feed
async function RecentActivity({ tenantId }: { tenantId: string }) {
  const activities = await getRecentActivity(tenantId)

  return (
    <Card className="glass-panel-subtle border-none">
      <CardHeader>
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-success" />
          <CardTitle className="text-base">Recent Activity</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        {activities.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Inbox className="h-10 w-10 text-muted-foreground/30 mb-3" />
            <p className="text-sm font-medium text-muted-foreground">No activity yet</p>
            <p className="text-xs text-muted-foreground/70 mt-1">Complete a match to see results here</p>
          </div>
        ) : (
          <div className="space-y-4">
            {activities.map((activity, i) => (
              <MotionWrapper key={i} variant="fadeInUp" delay={i * 0.1}>
                <div className="flex items-start gap-3 relative group">
                  <div className="absolute left-[3px] top-4 -bottom-4 w-px bg-border group-last:hidden" />
                  <div className="h-2 w-2 rounded-full bg-primary/60 mt-1.5 shrink-0 relative z-10 ring-4 ring-background group-hover:bg-primary transition-colors" />
                  <div className="pb-2">
                    <p className="text-sm font-medium">{activity.message}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{activity.time}</p>
                  </div>
                </div>
              </MotionWrapper>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ─── Main Page ────────────────────────────────────────────────

export default async function DashboardPage() {
  noStore()

  const { userId } = await auth()
  if (!userId) {
    redirect("/")
  }

  const tenant = await getMyTenant()
  if (!tenant) {
    redirect("/dashboard/league/setup")
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <MotionWrapper variant="fadeInLeft">
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Dashboard</h1>
          <p className="text-muted-foreground mt-1">Welcome back to your command center.</p>
        </MotionWrapper>
        <MotionWrapper variant="fadeInRight">
          <Link href="/dashboard/tournaments/new">
            <Button className="flex items-center gap-2 shadow-lg hover:shadow-primary/25" size="lg" variant="gradient-shine">
              <Plus className="w-4 h-4" />
              Create Tournament
            </Button>
          </Link>
        </MotionWrapper>
      </div>

      {/* Stats */}
      <Suspense fallback={<StatsLoading />}>
        <DashboardStats tenantId={tenant.id} />
      </Suspense>

      {/* Live Matches Banner */}
      <Suspense fallback={null}>
        <LiveMatchesBanner tenantId={tenant.id} />
      </Suspense>

      {/* Main Grid */}
      <div className="grid gap-6 lg:grid-cols-7">
        <div className="lg:col-span-4 space-y-6">
          <Suspense fallback={<Skeleton className="h-64 w-full rounded-2xl" />}>
            <RecentActivity tenantId={tenant.id} />
          </Suspense>
        </div>
        <div className="lg:col-span-3 space-y-6">
          <QuickActions />
          <Suspense fallback={<Skeleton className="h-48 w-full rounded-2xl" />}>
            <PointsTableWidget tenantId={tenant.id} />
          </Suspense>
          <Suspense fallback={<Skeleton className="h-48 w-full rounded-2xl" />}>
            <UpcomingMatchesSection tenantId={tenant.id} />
          </Suspense>
        </div>
      </div>
    </div>
  )
}
