import React from "react"
import { auth } from "@clerk/nextjs/server"
import { redirect } from "next/navigation"
import Link from "next/link"
import { Button } from "@mtk/ui/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@mtk/ui/components/ui/card"
import { Badge } from "@mtk/ui/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@mtk/ui/components/ui/tabs"
import { MotionWrapper } from "@mtk/ui/components/ui/motion-wrapper"
import { Trophy, Target, Award, Zap } from "lucide-react"
import { requireActiveLeagueContext, readBattingLeaderboard, readBowlingLeaderboard } from "@/lib/league-reads"
import { unstable_noStore as noStore } from "next/cache"

export default async function StatisticsPage() {
  noStore()

  const { userId } = await auth()
  if (!userId) redirect("/")

  // Exact active league + stats:read. Read failures propagate; they never become
  // a fake "no statistics" empty state.
  const context = await requireActiveLeagueContext("stats:read")
  const [topRunScorers, topSixHitters, topFourHitters, topWicketTakers] = await Promise.all([
    readBattingLeaderboard(context.tenantId, "runs"),
    readBattingLeaderboard(context.tenantId, "sixes"),
    readBattingLeaderboard(context.tenantId, "fours"),
    readBowlingLeaderboard(context.tenantId),
  ])

  const hasData = topRunScorers.length > 0 || topWicketTakers.length > 0

  return (
    <div className="space-y-6">
      {/* Header */}
      <MotionWrapper variant="fadeInLeft">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">League Statistics</h1>
            <p className="text-muted-foreground mt-1">
              Explore player performances and seasonal leaderboard stats.
            </p>
          </div>
          <Link href="/dashboard/stats/compare">
            <Button variant="outline" size="sm">Compare Players</Button>
          </Link>
        </div>
      </MotionWrapper>

      {!hasData ? (
        <MotionWrapper variant="fadeInUp" delay={0.1}>
          <Card className="bg-card/50 backdrop-blur-md border-border/40 py-12 text-center text-muted-foreground">
            <Trophy className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p className="font-semibold text-lg">No Stats Available Yet</p>
            <p className="text-sm mt-1">Start scoring matches and recording overs to populate leaderboards!</p>
            <Link href="/dashboard/scoring" className="inline-block mt-6">
              <Button variant="gradient-shine">
                Go to Scoring Console
              </Button>
            </Link>
          </Card>
        </MotionWrapper>
      ) : (
        <MotionWrapper variant="fadeInUp" delay={0.1}>
          <Tabs defaultValue="batting" className="space-y-4">
            <TabsList>
              <TabsTrigger value="batting">Batting Leaders</TabsTrigger>
              <TabsTrigger value="bowling">Bowling Leaders</TabsTrigger>
            </TabsList>

            {/* Batting Tab */}
            <TabsContent value="batting" className="grid gap-6 md:grid-cols-2">
              {/* Runs Leaderboard */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-3">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Trophy className="h-5 w-5 text-yellow-500" /> Most Runs
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {topRunScorers.map((scorer, idx) => (
                    <div key={scorer.playerId} className="flex items-center justify-between p-3 rounded-xl bg-muted/20 hover:bg-muted/30 transition-colors">
                      <div className="flex items-center gap-3">
                        <span className="font-bold text-sm text-muted-foreground tabular-nums w-4">
                          {idx + 1}
                        </span>
                        <div>
                          <p className="font-semibold text-sm">{scorer.playerName}</p>
                          <p className="text-xs text-muted-foreground">{scorer.teamName}</p>
                        </div>
                      </div>
                      <Badge className="font-bold text-sm px-2.5 py-1">
                        {Number(scorer.total).toLocaleString()} runs
                      </Badge>
                    </div>
                  ))}
                </CardContent>
              </Card>

              {/* Boundaries (Sixes) */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-3">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Zap className="h-5 w-5 text-orange-500" /> Most Sixes
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {topSixHitters.map((scorer, idx) => (
                    <div key={scorer.playerId} className="flex items-center justify-between p-3 rounded-xl bg-muted/20 hover:bg-muted/30 transition-colors">
                      <div className="flex items-center gap-3">
                        <span className="font-bold text-sm text-muted-foreground tabular-nums w-4">
                          {idx + 1}
                        </span>
                        <div>
                          <p className="font-semibold text-sm">{scorer.playerName}</p>
                          <p className="text-xs text-muted-foreground">{scorer.teamName}</p>
                        </div>
                      </div>
                      <Badge variant="outline" className="font-bold text-sm px-2.5 py-1">
                        {Number(scorer.total).toLocaleString()} sixes
                      </Badge>
                    </div>
                  ))}
                </CardContent>
              </Card>

              {/* Fours Leaderboard */}
              <Card className="md:col-span-2">
                <CardHeader className="flex flex-row items-center justify-between pb-3">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Award className="h-5 w-5 text-blue-500" /> Most Fours
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid gap-3 sm:grid-cols-2">
                  {topFourHitters.map((scorer, idx) => (
                    <div key={scorer.playerId} className="flex items-center justify-between p-3 rounded-xl bg-muted/20 hover:bg-muted/30 transition-colors">
                      <div className="flex items-center gap-3">
                        <span className="font-bold text-sm text-muted-foreground tabular-nums w-4">
                          {idx + 1}
                        </span>
                        <div>
                          <p className="font-semibold text-sm">{scorer.playerName}</p>
                          <p className="text-xs text-muted-foreground">{scorer.teamName}</p>
                        </div>
                      </div>
                      <Badge variant="secondary" className="font-bold text-sm px-2.5 py-1">
                        {Number(scorer.total).toLocaleString()} fours
                      </Badge>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Bowling Tab */}
            <TabsContent value="bowling" className="grid gap-6">
              {/* Wickets Leaderboard */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-3">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Target className="h-5 w-5 text-red-500" /> Most Wickets
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {topWicketTakers.map((bowler, idx) => (
                    <div key={bowler.playerId} className="flex items-center justify-between p-3 rounded-xl bg-muted/20 hover:bg-muted/30 transition-colors">
                      <div className="flex items-center gap-3">
                        <span className="font-bold text-sm text-muted-foreground tabular-nums w-4">
                          {idx + 1}
                        </span>
                        <div>
                          <p className="font-semibold text-sm">{bowler.playerName}</p>
                          <p className="text-xs text-muted-foreground">{bowler.teamName}</p>
                        </div>
                      </div>
                      <Badge className="font-bold text-sm px-2.5 py-1 bg-red-600 hover:bg-red-700">
                        {Number(bowler.total).toLocaleString()} wickets
                      </Badge>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </MotionWrapper>
      )}
    </div>
  )
}
