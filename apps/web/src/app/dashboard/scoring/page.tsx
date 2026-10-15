import React from "react"
import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"
import Link from "next/link"
import { Button } from "@mtk/ui/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@mtk/ui/components/ui/card"
import { Badge } from "@mtk/ui/components/ui/badge"
import { MotionWrapper } from "@mtk/ui/components/ui/motion-wrapper"
import { Play, Swords } from "lucide-react"
import { requireActiveLeagueContext, readScoringConsoleMatches } from "@/lib/league-reads"
import { unstable_noStore as noStore } from "next/cache"

export default async function ScoringConsolePage() {
  noStore()

  const { userId } = await auth()
  if (!userId) redirect("/")

  // Exact active league + match:read. Match and team-name reads are league-scoped
  // and failures propagate instead of rendering a fake empty console.
  const context = await requireActiveLeagueContext("match:read")
  const { matches, truncated } = await readScoringConsoleMatches(context.tenantId)

  const resolvedMatches = matches.map((m) => ({
    ...m,
    formattedDate: m.scheduledDate
      ? new Date(m.scheduledDate).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
      : "TBD",
  }))

  return (
    <div className="space-y-6">
      {/* Header */}
      <MotionWrapper variant="fadeInLeft">
        <h1 className="text-3xl font-bold tracking-tight">Scoring Console</h1>
        <p className="text-muted-foreground mt-1">
          Select a live or scheduled match to launch the real-time scoring dashboard interface.
        </p>
      </MotionWrapper>

      {/* Matches List */}
      <MotionWrapper variant="fadeInUp" delay={0.1}>
        <div className="grid gap-4 md:grid-cols-2">
          {resolvedMatches.map((m) => {
            const isLive = m.status === "live" || m.status === "innings_break"
            return (
              <Card key={m.id} className="hover:shadow-md transition-shadow relative overflow-hidden">
                {isLive && (
                  <div className="absolute top-0 left-0 right-0 h-1 bg-red-500 animate-pulse" />
                )}
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <Badge variant="outline" role={isLive ? "status" : undefined} aria-live={isLive ? "polite" : undefined} className={`text-xs ${isLive ? "bg-red-500/10 text-red-500 border-red-500/20 animate-pulse" : "bg-primary/5 text-primary border-primary/20"}`}>
                      {isLive ? "LIVE SCORING" : "SCHEDULED"}
                    </Badge>
                    <span className="text-xs text-muted-foreground font-mono">{m.formattedDate}</span>
                  </div>
                  <CardTitle className="text-lg font-bold mt-2">
                    {m.teamAName} <span className="text-xs text-muted-foreground font-normal">vs</span> {m.teamBName}
                  </CardTitle>
                  <CardDescription className="capitalize">
                    Format: {m.matchFormat} · {m.totalOvers} Overs
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-0 flex justify-end">
                  <Link href={`/matches/${m.id}/scoring`}>
                    <Button variant={isLive ? "destructive" : "default"} size="sm">
                      <Play className="h-4 w-4 mr-1.5 fill-current" />
                      {isLive ? "Resume Scoring" : "Start Scoring"}
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            )
          })}
          {truncated && (
            <Card className="md:col-span-2 border-dashed text-center text-sm text-muted-foreground py-4">
              Showing the first {resolvedMatches.length} matches. Complete or archive current matches to see the rest.
            </Card>
          )}
          {resolvedMatches.length === 0 && (
            <Card className="md:col-span-2 bg-card/50 backdrop-blur-md py-12 text-center text-muted-foreground">
              <Swords className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="font-semibold text-lg">No Active or Scheduled Matches</p>
              <p className="text-sm mt-1">Go to Matches or Tournaments page to schedule a new match.</p>
            </Card>
          )}
        </div>
      </MotionWrapper>
    </div>
  )
}
