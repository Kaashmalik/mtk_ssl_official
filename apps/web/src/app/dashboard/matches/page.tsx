import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"
import Link from "next/link"
import { Button } from "@mtk/ui/components/ui/button"
import { Card, CardContent } from "@mtk/ui/components/ui/card"
import { Badge } from "@mtk/ui/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@mtk/ui/components/ui/tabs"
import { MotionWrapper } from "@mtk/ui/components/ui/motion-wrapper"
import { Plus, Clock, CheckCircle2, Inbox } from "lucide-react"
import { getMyTenant } from "@/app/actions/tenants"
import { db, teams, matches, matchInnings } from "@mtk/database"
import { eq, and, desc } from "drizzle-orm"
import { unstable_noStore as noStore } from "next/cache"

// ─── Helpers ──────────────────────────────────────────────────

async function getTeamName(teamId: string): Promise<string> {
  try {
    const [team] = await db.select({ name: teams.name }).from(teams).where(eq(teams.id, teamId)).limit(1)
    return team?.name ?? "TBD"
  } catch {
    return "TBD"
  }
}

async function getInningsForMatch(matchId: string) {
  try {
    return await db.select().from(matchInnings).where(eq(matchInnings.matchId, matchId)).orderBy(matchInnings.inningsNumber)
  } catch {
    return []
  }
}

function formatScore(innings: { totalRuns: number; totalWickets: number; totalBalls: number } | undefined): string {
  if (!innings) return "—"
  const overs = `${Math.floor(innings.totalBalls / 6)}.${innings.totalBalls % 6}`
  return `${innings.totalRuns}/${innings.totalWickets} (${overs})`
}

function formatDate(date: Date | null): string {
  if (!date) return "TBD"
  return new Intl.DateTimeFormat("en-PK", { dateStyle: "medium", timeStyle: "short" }).format(new Date(date))
}

// ─── Data Fetching ────────────────────────────────────────────

async function getMatchesByStatus(tenantId: string, status: "live" | "scheduled" | "completed") {
  try {
    let matchesRaw
    if (status === "completed") {
      matchesRaw = await db.select().from(matches)
        .where(and(eq(matches.tenantId, tenantId), eq(matches.status, "completed")))
        .orderBy(desc(matches.updatedAt))
        .limit(20)
    } else if (status === "scheduled") {
      matchesRaw = await db.select().from(matches)
        .where(and(eq(matches.tenantId, tenantId), eq(matches.status, "scheduled")))
        .orderBy(matches.scheduledDate)
        .limit(20)
    } else {
      matchesRaw = await db.select().from(matches)
        .where(and(eq(matches.tenantId, tenantId), eq(matches.status, "live")))
        .limit(20)
    }

    return await Promise.all(
      matchesRaw.map(async (m) => {
        const [teamAName, teamBName, innings] = await Promise.all([
          getTeamName(m.teamAId),
          getTeamName(m.teamBId),
          getInningsForMatch(m.id),
        ])
        const inn1 = innings.find((i) => i.inningsNumber === 1)
        const inn2 = innings.find((i) => i.inningsNumber === 2)

        return {
          id: m.id,
          teamA: teamAName,
          teamB: teamBName,
          scoreA: formatScore(inn1),
          scoreB: formatScore(inn2),
          target: inn1 ? inn1.totalRuns + 1 : 0,
          format: m.matchFormat?.toUpperCase() ?? "T20",
          date: formatDate(m.scheduledDate),
          venue: "", // future: join with venues table
          result: m.result,
          status: m.status,
          manOfMatch: m.manOfMatchId, // future: resolve player name
        }
      })
    )
  } catch (error) {
    console.error(`Failed to fetch ${status} matches:`, error)
    return []
  }
}

// ─── Empty State ──────────────────────────────────────────────

function EmptyState({ icon: Icon, title, description, actionHref, actionLabel }: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  description: string
  actionHref?: string
  actionLabel?: string
}) {
  return (
    <MotionWrapper variant="fadeInUp">
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="rounded-full bg-muted/50 p-4 mb-4">
          <Icon className="h-8 w-8 text-muted-foreground/40" />
        </div>
        <p className="text-sm font-medium text-muted-foreground">{title}</p>
        <p className="text-xs text-muted-foreground/70 mt-1">{description}</p>
        {actionHref && actionLabel && (
          <Link href={actionHref}>
            <Button variant="link" size="sm" className="mt-2 text-xs">{actionLabel}</Button>
          </Link>
        )}
      </div>
    </MotionWrapper>
  )
}

// ─── Page ─────────────────────────────────────────────────────

export default async function MatchesPage() {
  noStore()

  const { userId } = await auth()
  if (!userId) redirect("/")

  const tenant = await getMyTenant()
  if (!tenant) redirect("/dashboard/league/setup")

  const [liveMatches, upcomingMatches, completedMatches] = await Promise.all([
    getMatchesByStatus(tenant.id, "live"),
    getMatchesByStatus(tenant.id, "scheduled"),
    getMatchesByStatus(tenant.id, "completed"),
  ])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <MotionWrapper variant="fadeInLeft">
          <h1 className="text-3xl font-bold tracking-tight">Matches</h1>
          <p className="text-muted-foreground mt-1">Schedule, score, and review cricket matches.</p>
        </MotionWrapper>
        <MotionWrapper variant="fadeInRight">
          <Link href="/dashboard/matches/new">
            <Button variant="gradient-shine" size="lg"><Plus className="mr-2 h-4 w-4" />Schedule Match</Button>
          </Link>
        </MotionWrapper>
      </div>

      <Tabs defaultValue="live" className="space-y-4">
        <TabsList>
          <TabsTrigger value="live" className="flex items-center gap-1.5">
            <span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-live opacity-75" /><span className="relative inline-flex rounded-full h-2 w-2 bg-live" /></span>
            Live ({liveMatches.length})
          </TabsTrigger>
          <TabsTrigger value="upcoming"><Clock className="h-3.5 w-3.5 mr-1" />Upcoming ({upcomingMatches.length})</TabsTrigger>
          <TabsTrigger value="completed"><CheckCircle2 className="h-3.5 w-3.5 mr-1" />Completed ({completedMatches.length})</TabsTrigger>
        </TabsList>

        {/* Live Tab */}
        <TabsContent value="live" className="space-y-4">
          {liveMatches.length === 0 ? (
            <EmptyState icon={Inbox} title="No live matches right now" description="Start a match to see live scoring here" />
          ) : (
            liveMatches.map((m) => (
              <MotionWrapper key={m.id} variant="fadeInUp">
                <Link href={`/dashboard/matches/${m.id}`}>
                  <Card className="border-live/20 bg-gradient-to-r from-live/5 via-transparent to-live/5 hover:shadow-lg transition-all cursor-pointer overflow-hidden">
                    <div className="h-0.5 bg-gradient-to-r from-live via-live/60 to-transparent" />
                    <CardContent className="pt-4 pb-4">
                      <div className="flex items-center gap-2 mb-3">
                        <span className="relative flex h-2.5 w-2.5"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-live opacity-75" /><span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-live" /></span>
                        <span className="text-xs font-semibold text-live uppercase">Live</span>
                        <Badge variant="outline" className="text-xs ml-auto">{m.format}</Badge>
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between"><span className="font-semibold">{m.teamA}</span><span className="font-bold text-lg tabular-nums">{m.scoreA}</span></div>
                        <div className="flex items-center justify-between"><span className="font-semibold">{m.teamB}</span><span className="font-bold text-lg tabular-nums">{m.scoreB}</span></div>
                      </div>
                      {m.target > 0 && m.scoreB !== "—" && (
                        <p className="text-xs text-muted-foreground mt-2">
                          {m.teamB} need {Math.max(0, m.target - parseInt(m.scoreB))} more runs
                        </p>
                      )}
                    </CardContent>
                  </Card>
                </Link>
              </MotionWrapper>
            ))
          )}
        </TabsContent>

        {/* Upcoming Tab */}
        <TabsContent value="upcoming" className="space-y-3">
          {upcomingMatches.length === 0 ? (
            <EmptyState icon={Clock} title="No upcoming matches scheduled" description="Schedule a match to see it here" actionHref="/dashboard/matches/new" actionLabel="Schedule Match" />
          ) : (
            upcomingMatches.map((m, i) => (
              <MotionWrapper key={m.id} variant="fadeInUp" delay={0.05 * i}>
                <Link href={`/dashboard/matches/${m.id}`}>
                  <Card className="hover:shadow-md hover:-translate-y-0.5 transition-all cursor-pointer">
                    <CardContent className="py-4 flex items-center justify-between">
                      <div className="flex-1">
                        <p className="font-semibold text-sm">{m.teamA} vs {m.teamB}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{m.date}</p>
                      </div>
                      <Badge variant="outline" className="text-xs">{m.format}</Badge>
                    </CardContent>
                  </Card>
                </Link>
              </MotionWrapper>
            ))
          )}
        </TabsContent>

        {/* Completed Tab */}
        <TabsContent value="completed" className="space-y-3">
          {completedMatches.length === 0 ? (
            <EmptyState icon={CheckCircle2} title="No completed matches yet" description="Complete a match to see results here" />
          ) : (
            completedMatches.map((m, i) => (
              <MotionWrapper key={m.id} variant="fadeInUp" delay={0.05 * i}>
                <Link href={`/dashboard/matches/${m.id}`}>
                  <Card className="hover:shadow-md hover:-translate-y-0.5 transition-all cursor-pointer">
                    <CardContent className="py-4">
                      <div className="flex items-center justify-between mb-2">
                        <div className="space-y-1">
                          <div className="flex items-center justify-between gap-8">
                            <span className="font-semibold text-sm">{m.teamA}</span>
                            <span className="font-bold tabular-nums text-sm">{m.scoreA}</span>
                          </div>
                          <div className="flex items-center justify-between gap-8">
                            <span className="font-semibold text-sm">{m.teamB}</span>
                            <span className="font-bold tabular-nums text-sm">{m.scoreB}</span>
                          </div>
                        </div>
                        <Badge variant="outline" className="text-xs text-muted-foreground">{m.date}</Badge>
                      </div>
                      {m.result && <p className="text-xs text-success font-medium">{m.result}</p>}
                    </CardContent>
                  </Card>
                </Link>
              </MotionWrapper>
            ))
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
