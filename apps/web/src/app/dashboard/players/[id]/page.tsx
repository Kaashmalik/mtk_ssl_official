import Link from "next/link"
import { Button } from "@mtk/ui/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@mtk/ui/components/ui/card"
import { Badge } from "@mtk/ui/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@mtk/ui/components/ui/tabs"
import { MotionWrapper } from "@mtk/ui/components/ui/motion-wrapper"
import { ArrowLeft, Edit, Trophy, Target, Crosshair, Shield } from "lucide-react"
import { getPlayer, deletePlayer } from "@/app/actions/players"
import { DeleteButton } from "@/components/shared/delete-button"
import { isFollowing, getFollowerCount } from "@/app/actions/follows"
import { PlayerIdActions } from "@/components/players/player-id-actions"
import { FollowButton } from "@/components/shared/follow-button"
import { db, teams, battingScorecards, bowlingScorecards, matches, tournaments, playerIds } from "@mtk/database"
import { eq, and, inArray, desc } from "drizzle-orm"
import { notFound } from "next/navigation"
import { unstable_noStore as noStore } from "next/cache"

const ROLE_LABELS: Record<string, string> = { 
  batsman: "Batsman", 
  bowler: "Bowler", 
  all_rounder: "All Rounder", 
  wicket_keeper: "Wicket Keeper",
  wicket_keeper_batsman: "Wicket Keeper Batsman" 
}

const BATTING_STYLE_LABELS: Record<string, string> = {
  right: "Right-Hand Bat",
  left: "Left-Hand Bat"
}

const BOWLING_STYLE_LABELS: Record<string, string> = {
  right_arm_fast: "Right-Arm Fast",
  right_arm_medium: "Right-Arm Medium",
  right_arm_spin: "Right-Arm Spin",
  left_arm_fast: "Left-Arm Fast",
  left_arm_medium: "Left-Arm Medium",
  left_arm_spin: "Left-Arm Spin"
}

export default async function PlayerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  noStore()
  const { id } = await params
  
  const player = await getPlayer(id)
  if (!player) {
    notFound()
  }

  const followingState = await isFollowing("player", id)
  const followersCount = await getFollowerCount("player", id)

  // Resolve Team name
  let teamName = "Unassigned"
  if (player.teamId) {
    const [team] = await db.select({ name: teams.name }).from(teams).where(eq(teams.id, player.teamId)).limit(1)
    if (team) {
      teamName = team.name
    }
  }

  // Issued league ID card (if any)
  const [playerIdCard] = await db.select({
    id: playerIds.id,
    formattedId: playerIds.formattedId,
    isValid: playerIds.isValid,
  })
    .from(playerIds)
    .where(and(eq(playerIds.playerId, id), eq(playerIds.tenantId, player.tenantId)))
    .limit(1)

  // Fetch all scorecard stats for the player
  const battingStats = await db.select().from(battingScorecards)
    .where(eq(battingScorecards.playerId, id))

  const bowlingStats = await db.select().from(bowlingScorecards)
    .where(eq(bowlingScorecards.playerId, id))

  // Calculate career statistics
  const playerMatchIds = Array.from(new Set([
    ...battingStats.map(b => b.matchId),
    ...bowlingStats.map(b => b.matchId)
  ]))

  const careerMatchesPlayed = playerMatchIds.length
  const careerRunsScored = battingStats.reduce((sum, curr) => sum + curr.runs, 0)
  const careerBallsFaced = battingStats.reduce((sum, curr) => sum + curr.ballsFaced, 0)

  const careerHigh = battingStats.length > 0 ? Math.max(...battingStats.map(b => b.runs)) : 0
  const isHighNotOut = battingStats.some(b => b.runs === careerHigh && b.dismissalType === "not_out")
  const careerHighText = careerHigh > 0 ? `${careerHigh}${isHighNotOut ? "*" : ""}` : "0"

  const careerFifties = battingStats.filter(b => b.runs >= 50 && b.runs < 100).length
  const careerHundreds = battingStats.filter(b => b.runs >= 100).length

  // Batting Average calculation
  const dismissedCount = battingStats.filter(b => b.dismissalType !== "not_out" && b.dismissalType !== "retired_hurt").length
  const battingAvg = dismissedCount > 0 
    ? (careerRunsScored / dismissedCount).toFixed(2) 
    : (careerRunsScored > 0 ? careerRunsScored.toFixed(2) : "0.00")

  // Batting Strike Rate calculation
  const strikeRate = careerBallsFaced > 0 
    ? ((careerRunsScored / careerBallsFaced) * 100).toFixed(2) 
    : "0.00"

  // Fetch match details for matches the player played in
  const recentMatchesRaw = playerMatchIds.length > 0
    ? await db.select().from(matches)
        .where(inArray(matches.id, playerMatchIds))
        .orderBy(desc(matches.scheduledDate))
        .limit(5)
    : []

  const recentMatches = await Promise.all(recentMatchesRaw.map(async (m) => {
    const oppId = m.teamAId === player.teamId ? m.teamBId : m.teamAId
    const [opp] = await db.select({ name: teams.name }).from(teams).where(eq(teams.id, oppId)).limit(1)
    const oppName = opp?.name ?? "TBD"

    const matchBat = battingStats.find(b => b.matchId === m.id)
    const matchBowl = bowlingStats.find(b => b.matchId === m.id)

    let perfText = ""
    if (matchBat) {
      perfText += `${matchBat.runs}(${matchBat.ballsFaced})`
      if (matchBat.dismissalType === "not_out") perfText += "*"
    }
    if (matchBowl) {
      if (perfText) perfText += " & "
      perfText += `${matchBowl.wickets}/${matchBowl.runsConceded}`
    }
    if (!perfText) perfText = "DNP"

    const formattedDate = m.scheduledDate
      ? new Date(m.scheduledDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })
      : "TBD"

    let isWin = false
    if (m.status === "completed" && m.winnerId === player.teamId) {
      isWin = true
    }

    return {
      vs: oppName,
      score: perfText,
      result: isWin ? "Won" : m.status === "completed" ? "Lost" : m.status.toUpperCase(),
      isWin,
      date: formattedDate
    }
  }))

  // Resolve tournament-by-tournament season stats
  const tournamentIds = Array.from(new Set(recentMatchesRaw.map(m => m.tournamentId).filter(Boolean))) as string[]
  const seasons = await Promise.all(tournamentIds.map(async (tId) => {
    const [tournament] = await db.select({ name: tournaments.name }).from(tournaments).where(eq(tournaments.id, tId)).limit(1)
    const tournamentName = tournament?.name ?? "Other Tournament"

    const tMatches = recentMatchesRaw.filter(m => m.tournamentId === tId)
    const tMatchIds = tMatches.map(m => m.id)

    const tBat = battingStats.filter(b => tMatchIds.includes(b.matchId))
    const tBowl = bowlingStats.filter(b => tMatchIds.includes(b.matchId))

    const tRuns = tBat.reduce((sum, curr) => sum + curr.runs, 0)
    const tBalls = tBat.reduce((sum, curr) => sum + curr.ballsFaced, 0)
    const tDismissed = tBat.filter(b => b.dismissalType !== "not_out" && b.dismissalType !== "retired_hurt").length
    const tWickets = tBowl.reduce((sum, curr) => sum + curr.wickets, 0)

    const avg = tDismissed > 0 ? (tRuns / tDismissed).toFixed(2) : (tRuns > 0 ? tRuns.toFixed(2) : "0.00")
    const sr = tBalls > 0 ? ((tRuns / tBalls) * 100).toFixed(2) : "0.00"

    const tHigh = tBat.length > 0 ? Math.max(...tBat.map(b => b.runs)) : 0
    const isTHighNotOut = tBat.some(b => b.runs === tHigh && b.dismissalType === "not_out")
    const hsText = tHigh > 0 ? `${tHigh}${isTHighNotOut ? "*" : ""}` : "0"

    return {
      name: tournamentName,
      matches: tMatches.length,
      runs: tRuns,
      avg,
      sr,
      hs: hsText,
      wickets: tWickets
    }
  }))

  const nameInitial = player.name.charAt(0)
  const formattedDob = player.dateOfBirth 
    ? new Date(player.dateOfBirth).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : "—"

  return (
    <div className="space-y-6">
      {/* Header */}
      <MotionWrapper variant="fadeInLeft">
        <div className="flex items-center gap-4">
          <Link href="/dashboard/players">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />Back
            </Button>
          </Link>
        </div>
      </MotionWrapper>

      {/* Profile Hero */}
      <MotionWrapper variant="fadeInUp" delay={0.1}>
        <Card className="overflow-hidden">
          <div className="h-24 bg-gradient-to-r from-primary/20 via-primary/10 to-transparent" />
          <CardContent className="-mt-12 pb-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-end gap-4">
              <div className="h-20 w-20 rounded-2xl bg-primary/10 border-4 border-card flex items-center justify-center text-primary font-bold text-2xl shadow-lg">
                {nameInitial}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-2xl font-bold">{player.name}</h1>
                  <Badge variant="outline" className="text-xs">#{player.jerseyNumber !== null ? player.jerseyNumber : "—"}</Badge>
                  <Badge variant="outline" className="text-xs bg-success/10 text-success border-success/20 capitalize">{player.status}</Badge>
                </div>
                <p className="text-muted-foreground text-sm mt-1">{teamName} · {player.city || "TBD City"}, {player.nationality || "TBD Nationality"}</p>
              </div>
              <div className="flex gap-2">
                <FollowButton
                  tenantId={player.tenantId}
                  followableType="player"
                  followableId={id}
                  initialIsFollowing={followingState}
                  initialFollowerCount={followersCount}
                />
<Link href={`/dashboard/players/${id}/edit`}>
                    <Button variant="outline" size="sm">
                      <Edit className="h-4 w-4 mr-1" />Edit
                    </Button>
                  </Link>
                  <PlayerIdActions playerId={id} card={playerIdCard ?? null} />
                <DeleteButton
                  action={deletePlayer}
                  id={id}
                  redirectHref="/dashboard/players"
                  entityLabel="player"
                  entityName={player.name}
                />
              </div>
            </div>
          </CardContent>
        </Card>
      </MotionWrapper>

      {/* Career Stats Cards */}
      <MotionWrapper variant="fadeInUp" delay={0.2}>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
          {[
            { label: "Matches", value: careerMatchesPlayed, icon: Shield },
            { label: "Runs", value: careerRunsScored.toLocaleString(), icon: Target },
            { label: "Average", value: battingAvg, icon: Trophy },
            { label: "Strike Rate", value: strikeRate, icon: Crosshair },
            { label: "50s / 100s", value: `${careerFifties} / ${careerHundreds}` },
            { label: "Highest", value: careerHighText },
          ].map((stat, i) => (
            <Card key={i} className="text-center">
              <CardContent className="pt-4 pb-3">
                <p className="text-2xl font-bold tabular-nums">{stat.value}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{stat.label}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </MotionWrapper>

      {/* Tabbed Content */}
      <MotionWrapper variant="fadeInUp" delay={0.3}>
        <Tabs defaultValue="seasons" className="space-y-4">
          <TabsList>
            <TabsTrigger value="seasons">Season Stats ({seasons.length})</TabsTrigger>
            <TabsTrigger value="matches">Recent Matches ({recentMatches.length})</TabsTrigger>
            <TabsTrigger value="info">Profile Info</TabsTrigger>
          </TabsList>

          <TabsContent value="seasons">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Season-by-Season Performance</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-muted-foreground text-xs">
                        <th className="py-2 text-left font-medium">Season</th>
                        <th className="py-2 text-center font-medium">M</th>
                        <th className="py-2 text-center font-medium">Runs</th>
                        <th className="py-2 text-center font-medium">Avg</th>
                        <th className="py-2 text-center font-medium">SR</th>
                        <th className="py-2 text-center font-medium">HS</th>
                        <th className="py-2 text-center font-medium">Wkts</th>
                      </tr>
                    </thead>
                    <tbody>
                      {seasons.map((s, i) => (
                        <tr key={i} className="border-b last:border-0 hover:bg-muted/20">
                          <td className="py-2.5 font-medium text-left">{s.name}</td>
                          <td className="py-2.5 text-center tabular-nums">{s.matches}</td>
                          <td className="py-2.5 text-center tabular-nums font-semibold">{s.runs}</td>
                          <td className="py-2.5 text-center tabular-nums">{s.avg}</td>
                          <td className="py-2.5 text-center tabular-nums">{s.sr}</td>
                          <td className="py-2.5 text-center tabular-nums">{s.hs}</td>
                          <td className="py-2.5 text-center tabular-nums">{s.wickets}</td>
                        </tr>
                      ))}
                      {seasons.length === 0 && (
                        <tr>
                          <td colSpan={7} className="py-4 text-center text-muted-foreground text-sm">
                            No season statistics available.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="matches">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Recent Performances</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {recentMatches.map((m, i) => (
                  <div key={i} className="flex items-center justify-between p-3 rounded-xl bg-muted/20 hover:bg-muted/30 transition-colors">
                    <div>
                      <p className="font-semibold text-sm">vs {m.vs}</p>
                      <p className="text-xs text-muted-foreground">{m.date}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-bold tabular-nums">{m.score}</p>
                      <Badge variant="outline" className={`text-xs mt-1 ${m.result === "Won" ? "text-success border-success/20 bg-success/5" : "text-destructive border-destructive/20 bg-destructive/5"}`}>
                        {m.result}
                      </Badge>
                    </div>
                  </div>
                ))}
                {recentMatches.length === 0 && (
                  <div className="py-8 text-center text-muted-foreground text-sm">
                    No recent match performances found.
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="info">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Player Information</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {[
                    ["Role", player.role ? (ROLE_LABELS[player.role] || player.role.replace("_", " ")) : "—"],
                    ["Batting Style", player.battingStyle ? (BATTING_STYLE_LABELS[player.battingStyle] || player.battingStyle) : "—"],
                    ["Bowling Style", player.bowlingStyle ? (BOWLING_STYLE_LABELS[player.bowlingStyle] || player.bowlingStyle) : "—"],
                    ["Date of Birth", formattedDob],
                    ["Height", player.heightCm ? `${player.heightCm} cm` : "—"],
                    ["Weight", player.weightKg ? `${player.weightKg} kg` : "—"],
                    ["City", player.city || "—"],
                    ["Nationality", player.nationality || "—"],
                  ].map(([label, value]) => (
                    <div key={label as string}>
                      <dt className="text-xs text-muted-foreground">{label}</dt>
                      <dd className="font-medium text-sm capitalize">{value ?? "—"}</dd>
                    </div>
                  ))}
                </dl>
                {player.biography && <p className="mt-4 text-sm text-muted-foreground border-t pt-4">{player.biography}</p>}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </MotionWrapper>
    </div>
  )
}
