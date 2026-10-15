import React from "react"
import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"
import Link from "next/link"
import { Button } from "@mtk/ui/components/ui/button"
import { Card, CardContent } from "@mtk/ui/components/ui/card"
import { Badge } from "@mtk/ui/components/ui/badge"
import { MotionWrapper } from "@mtk/ui/components/ui/motion-wrapper"
import { Progress } from "@mtk/ui/components/ui/progress"
import { Plus, Trophy, CalendarDays, Users, Swords, ArrowRight } from "lucide-react"
import { requireActiveLeagueContext } from "@/lib/league-reads"
import { readTournamentList } from "@/lib/tournament-reads"
import { unstable_noStore as noStore } from "next/cache"

// ─── Constants ────────────────────────────────────────────────

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

// ─── Page ─────────────────────────────────────────────────────

export default async function TournamentsPage() {
  noStore()

  const { userId } = await auth()
  if (!userId) redirect("/")

  // Exact active league + tournament:read. Read failures propagate instead of
  // rendering a fake empty list.
  const context = await requireActiveLeagueContext("tournament:read")
  const { tournaments, truncated } = await readTournamentList(context.tenantId)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <MotionWrapper variant="fadeInLeft">
          <h1 className="text-3xl font-bold tracking-tight">Tournaments</h1>
          <p className="text-muted-foreground mt-1">Create and manage your cricket tournaments.</p>
        </MotionWrapper>
        <MotionWrapper variant="fadeInRight">
          <Link href="/dashboard/tournaments/new">
            <Button variant="gradient-shine" size="lg"><Plus className="mr-2 h-4 w-4" />New Tournament</Button>
          </Link>
        </MotionWrapper>
      </div>

      {/* Stats Row */}
      <MotionWrapper variant="fadeInUp" delay={0.1}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-xl border bg-card p-4">
            <p className="text-2xl font-bold tabular-nums">{tournaments.length}</p>
            <p className="text-xs text-muted-foreground">Total Tournaments</p>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <p className="text-2xl font-bold tabular-nums text-live">{tournaments.filter((t) => t.status === "live").length}</p>
            <p className="text-xs text-muted-foreground">Active Now</p>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <p className="text-2xl font-bold tabular-nums text-info">{tournaments.filter((t) => t.status === "registration").length}</p>
            <p className="text-xs text-muted-foreground">Registration Open</p>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <p className="text-2xl font-bold tabular-nums text-success">{tournaments.filter((t) => t.status === "completed").length}</p>
            <p className="text-xs text-muted-foreground">Completed</p>
          </div>
        </div>
      </MotionWrapper>

      {/* Tournament Cards Grid */}
      {tournaments.length === 0 ? (
        <MotionWrapper variant="fadeInUp">
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="rounded-full bg-muted/50 p-5 mb-4">
              <Trophy className="h-10 w-10 text-muted-foreground/40" />
            </div>
            <p className="text-lg font-semibold text-muted-foreground">No tournaments yet</p>
            <p className="text-sm text-muted-foreground/70 mt-1 max-w-sm">Create your first tournament to get started with scheduling matches, registering teams, and tracking standings.</p>
            <Link href="/dashboard/tournaments/new">
              <Button variant="gradient-shine" size="lg" className="mt-6">
                <Plus className="mr-2 h-4 w-4" />Create First Tournament
              </Button>
            </Link>
          </div>
        </MotionWrapper>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {tournaments.map((tournament, i) => {
            const matchProgress = tournament.totalMatches > 0
              ? Math.round((tournament.completedMatches / tournament.totalMatches) * 100)
              : 0

            return (
              <MotionWrapper key={tournament.id} variant="fadeInUp" delay={0.1 * i}>
                <Link href={`/dashboard/tournaments/${tournament.id}`}>
                  <Card className="hover:shadow-lg hover:-translate-y-1 transition-all cursor-pointer group overflow-hidden">
                    {tournament.status === "live" && (
                      <div className="h-0.5 bg-gradient-to-r from-live via-live/60 to-transparent" />
                    )}
                    <CardContent className="pt-5 pb-5">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex-1 min-w-0">
                          <h3 className="font-bold text-base truncate group-hover:text-primary transition-colors">{tournament.name}</h3>
                          {tournament.description && (
                            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{tournament.description}</p>
                          )}
                        </div>
                        <Badge variant="outline" className={`text-xs shrink-0 ml-3 ${STATUS_COLORS[tournament.status ?? "draft"]}`}>
                          {STATUS_LABELS[tournament.status ?? "draft"]}
                        </Badge>
                      </div>

                      <div className="flex items-center gap-4 text-xs text-muted-foreground mb-3">
                        <div className="flex items-center gap-1">
                          <Trophy className="h-3 w-3" />
                          <span>{FORMAT_LABELS[tournament.format ?? "league"]}</span>
                        </div>
                        {tournament.startDate && (
                          <div className="flex items-center gap-1">
                            <CalendarDays className="h-3 w-3" />
                            <span>{new Intl.DateTimeFormat("en-PK", { dateStyle: "medium" }).format(new Date(tournament.startDate))}</span>
                          </div>
                        )}
                      </div>

                      <div className="grid grid-cols-3 gap-3 mb-4">
                        <div className="text-center py-2 rounded-lg bg-muted/30">
                          <p className="text-sm font-bold tabular-nums">{tournament.registeredTeams}</p>
                          <p className="text-[10px] text-muted-foreground flex items-center justify-center gap-0.5"><Users className="h-2.5 w-2.5" />Teams</p>
                        </div>
                        <div className="text-center py-2 rounded-lg bg-muted/30">
                          <p className="text-sm font-bold tabular-nums">{tournament.totalMatches}</p>
                          <p className="text-[10px] text-muted-foreground flex items-center justify-center gap-0.5"><Swords className="h-2.5 w-2.5" />Matches</p>
                        </div>
                        <div className="text-center py-2 rounded-lg bg-muted/30">
                          <p className="text-sm font-bold tabular-nums">{tournament.completedMatches}</p>
                          <p className="text-[10px] text-muted-foreground flex items-center justify-center gap-0.5">Played</p>
                        </div>
                      </div>

                      {tournament.totalMatches > 0 && (
                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-[10px]">
                            <span className="text-muted-foreground">Match progress</span>
                            <span className="font-medium">{matchProgress}%</span>
                          </div>
                          <Progress value={matchProgress} className="h-1.5" />
                        </div>
                      )}

                      <div className="flex items-center justify-end mt-3">
                        <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              </MotionWrapper>
            )
          })}
        </div>
      )}

      {truncated && (
        <p className="text-sm text-muted-foreground text-center">
          Showing the first {tournaments.length} tournaments. Archive older tournaments to see the rest.
        </p>
      )}
    </div>
  )
}
