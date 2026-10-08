import Link from "next/link"
import { Button } from "@mtk/ui/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@mtk/ui/components/ui/card"
import { Badge } from "@mtk/ui/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@mtk/ui/components/ui/tabs"
import { MotionWrapper } from "@mtk/ui/components/ui/motion-wrapper"
import { ArrowLeft, Trophy } from "lucide-react"
import { getMatch, deleteMatch } from "@/app/actions/matches"
import { DeleteButton } from "@/components/shared/delete-button"
import { MatchLifecycleControls } from "@/components/matches/match-lifecycle-controls"
import { StreamStartModal } from "@/components/matches/stream-start-modal"
import { ScorerAssign } from "@/components/matches/scorer-assign"
import { getFullScorecard } from "@/app/actions/scorecards"
import { ShareButton } from "@/components/share/share-button"
import { db, teams, matchInnings, players, venues } from "@mtk/database"
import { eq, asc, inArray } from "drizzle-orm"
import { notFound } from "next/navigation"
import { unstable_noStore as noStore } from "next/cache"

export default async function MatchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  noStore()
  const { id } = await params
  
  const match = await getMatch(id)
  if (!match) {
    notFound()
  }

  // Fetch Team A details
  const [teamA] = await db.select().from(teams).where(eq(teams.id, match.teamAId)).limit(1)
  // Fetch Team B details
  const [teamB] = await db.select().from(teams).where(eq(teams.id, match.teamBId)).limit(1)

  if (!teamA || !teamB) {
    notFound()
  }

  // Fetch Venue details
  let venueName = "TBD Venue"
  if (match.venueId) {
    const [venue] = await db.select().from(venues).where(eq(venues.id, match.venueId)).limit(1)
    if (venue) {
      venueName = `${venue.name}, ${venue.city}`
    }
  }

  // Fetch Man of the Match details
  let momName = ""
  if (match.manOfMatchId) {
    const [momPlayer] = await db.select().from(players).where(eq(players.id, match.manOfMatchId)).limit(1)
    if (momPlayer) {
      momName = momPlayer.name
    }
  }

  // Players from both teams for Player of the Match selection
  const matchPlayers = await db.select({ id: players.id, name: players.name }).from(players)
    .where(inArray(players.teamId, [teamA.id, teamB.id]))

  // Fetch Innings details
  const inningsRaw = await db.select().from(matchInnings)
    .where(eq(matchInnings.matchId, id))
    .orderBy(asc(matchInnings.inningsNumber))

  // Fetch scorecard details
  const scorecard = await getFullScorecard(id)

  // Map batting & bowling per innings
  const innings = await Promise.all(inningsRaw.map(async (inn) => {
    const battingEntries = scorecard.batting.filter(b => b.inningsId === inn.id)
    const bowlingEntries = scorecard.bowling.filter(b => b.inningsId === inn.id)

    // Resolve player names
    const battingWithNames = await Promise.all(battingEntries.map(async (b) => {
      const [p] = await db.select({ name: players.name }).from(players).where(eq(players.id, b.playerId)).limit(1)
      
      // Also get bowler name and fielder name for dismissal text if needed
      let bowlerName = ""
      if (b.bowlerId) {
        const [bp] = await db.select({ name: players.name }).from(players).where(eq(players.id, b.bowlerId)).limit(1)
        bowlerName = bp?.name ?? ""
      }
      let fielderName = ""
      if (b.fielderId) {
        const [fp] = await db.select({ name: players.name }).from(players).where(eq(players.id, b.fielderId)).limit(1)
        fielderName = fp?.name ?? ""
      }

      // Generate a user-friendly dismissal text if none exists
      let dismissalText = b.dismissalText || ""
      if (!dismissalText && b.dismissalType && b.dismissalType !== "not_out") {
        if (b.dismissalType === "bowled") dismissalText = `b ${bowlerName}`
        else if (b.dismissalType === "caught") dismissalText = `c ${fielderName} b ${bowlerName}`
        else if (b.dismissalType === "caught_behind") dismissalText = `c ${fielderName} b ${bowlerName}`
        else if (b.dismissalType === "caught_and_bowled") dismissalText = `c & b ${bowlerName}`
        else if (b.dismissalType === "lbw") dismissalText = `lbw b ${bowlerName}`
        else if (b.dismissalType === "run_out") dismissalText = `run out (${fielderName})`
        else if (b.dismissalType === "stumped") dismissalText = `stumped ${fielderName} b ${bowlerName}`
        else dismissalText = b.dismissalType.replace("_", " ")
      } else if (b.dismissalType === "not_out") {
        dismissalText = "not out"
      }

      return {
        name: p?.name ?? "Unknown Player",
        dismissal: dismissalText,
        runs: b.runs,
        balls: b.ballsFaced,
        fours: b.fours,
        sixes: b.sixes,
        sr: b.strikeRate ? Number(b.strikeRate).toFixed(2) : "0.00"
      }
    }))

    const bowlingWithNames = await Promise.all(bowlingEntries.map(async (b) => {
      const [p] = await db.select({ name: players.name }).from(players).where(eq(players.id, b.playerId)).limit(1)
      return {
        name: p?.name ?? "Unknown Player",
        overs: b.overs ? Number(b.overs).toFixed(1) : "0.0",
        maidens: b.maidens,
        runs: b.runsConceded,
        wickets: b.wickets,
        economy: b.economyRate ? Number(b.economyRate).toFixed(2) : "0.00"
      }
    }))

    const battingTeam = inn.teamId === teamA.id ? teamA : teamB
    const totalOversPlayed = Math.floor(inn.totalBalls / 6) + (inn.totalBalls % 6) / 10
    
    // Extras text
    const extrasText = `${inn.extras} (w ${inn.wides}, nb ${inn.noBalls}, b ${inn.byes}, lb ${inn.legByes})`

    return {
      team: battingTeam.name,
      score: `${inn.totalRuns}/${inn.totalWickets}`,
      overs: totalOversPlayed.toFixed(1),
      batting: battingWithNames,
      bowling: bowlingWithNames,
      extras: extrasText,
    }
  }))

  const teamAColor = teamA.primaryColor || "#2D8B4E"
  const teamBColor = teamB.primaryColor || "#E74C3C"
  const teamAShort = teamA.shortName || teamA.name.substring(0, 3).toUpperCase()
  const teamBShort = teamB.shortName || teamB.name.substring(0, 3).toUpperCase()

  const formattedDate = match.scheduledDate 
    ? new Date(match.scheduledDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : "TBD"

  const formatText = match.matchFormat ? match.matchFormat.toUpperCase() : "T20"

  const tossWinnerTeam = match.tossWinnerId === teamA.id ? teamA : teamB
  const tossDecisionText = match.tossDecision === "bat" ? "elected to bat" : "elected to bowl"
  const tossText = match.tossWinnerId ? `${tossWinnerTeam.name} won toss and ${tossDecisionText}` : "Toss details not entered yet"

  const resultText = match.result || (match.status === "live" ? "Match is Live" : match.status === "scheduled" ? "Scheduled" : match.status.toUpperCase())

  // Innings scores helpers
  const teamAInnings = innings.find(inn => inn.team === teamA.name)
  const teamBInnings = innings.find(inn => inn.team === teamB.name)

  return (
    <div className="space-y-6">
      <MotionWrapper variant="fadeInLeft">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <Link href="/dashboard/matches">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />Back
            </Button>
          </Link>
          <div className="flex items-center gap-2">
            <Link href={`/dashboard/matches/${match.id}/edit`}>
              <Button variant="outline" size="sm">
                Edit Match
              </Button>
            </Link>
            <DeleteButton
              action={deleteMatch}
              id={match.id}
              redirectHref="/dashboard/matches"
              entityLabel="match"
              entityName={`${teamA.name} vs ${teamB.name}`}
            />
          </div>
        </div>
      </MotionWrapper>

      {/* Match Header Hero */}
      <MotionWrapper variant="fadeInUp" delay={0.1}>
        <Card className="overflow-hidden border-none shadow-xl relative text-white">
          <div className="absolute inset-0 z-0" style={{ background: `linear-gradient(135deg, ${teamAColor}, ${teamBColor})`, opacity: 0.85 }} />
          <div className="absolute inset-0 z-0 bg-black/20 backdrop-blur-md" />
          <CardContent className="pt-8 pb-6 relative z-10">
            <div className="flex items-center justify-between mb-6">
              <Badge variant="outline" className="text-xs border-white/30 text-white bg-white/10 backdrop-blur-sm">{formatText} · {venueName}</Badge>
              <div className="flex items-center gap-2">
                <ShareButton matchId={id} teamAName={teamA.name} teamBName={teamB.name} resultText={resultText} />
                <Badge variant="outline" className="text-xs border-white/30 text-white bg-white/10 backdrop-blur-sm">{formattedDate}</Badge>
              </div>
            </div>
            <div className="flex items-center justify-between gap-4">
              <div className="text-center flex-1">
                <div className="h-16 w-16 rounded-2xl mx-auto flex items-center justify-center text-white font-bold text-xl mb-3 shadow-[0_0_20px_rgba(0,0,0,0.3)] border-2 border-white/20" style={{ backgroundColor: teamAColor }}>{teamAShort}</div>
                <p className="font-bold text-base text-white">{teamA.name}</p>
                {teamAInnings ? (
                  <>
                    <p className="text-3xl font-bold tabular-nums mt-1 text-white">{teamAInnings.score}</p>
                    <p className="text-sm text-white/70 font-medium">({teamAInnings.overs} ov)</p>
                  </>
                ) : (
                  <p className="text-xl font-bold mt-2 text-white/50">TBD</p>
                )}
              </div>
              <div className="text-center px-4">
                <p className="text-xs text-white/50 font-bold tracking-widest uppercase">VS</p>
              </div>
              <div className="text-center flex-1">
                <div className="h-16 w-16 rounded-2xl mx-auto flex items-center justify-center text-white font-bold text-xl mb-3 shadow-[0_0_20px_rgba(0,0,0,0.3)] border-2 border-white/20" style={{ backgroundColor: teamBColor }}>{teamBShort}</div>
                <p className="font-bold text-base text-white">{teamB.name}</p>
                {teamBInnings ? (
                  <>
                    <p className="text-3xl font-bold tabular-nums mt-1 text-white">{teamBInnings.score}</p>
                    <p className="text-sm text-white/70 font-medium">({teamBInnings.overs} ov)</p>
                  </>
                ) : (
                  <p className="text-xl font-bold mt-2 text-white/50">TBD</p>
                )}
              </div>
            </div>
            <div className="mt-6 pt-4 border-t border-white/20 text-center">
              <p className="text-base font-bold text-white tracking-wide">{resultText}</p>
              <p className="text-sm text-white/80 mt-1 font-medium">{tossText}</p>
              {momName && (
                <p className="text-sm mt-2 flex items-center justify-center gap-1.5">
                  <Trophy className="h-4 w-4 text-yellow-400 drop-shadow-md" /> 
                  <span className="text-white/80">Player of the Match:</span> 
                  <span className="font-bold text-white">{momName}</span>
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </MotionWrapper>

      <MotionWrapper variant="fadeInUp" delay={0.15}>
        <MatchLifecycleControls
          matchId={match.id}
          status={match.status}
          teamA={{ id: teamA.id, name: teamA.name }}
          teamB={{ id: teamB.id, name: teamB.name }}
          players={matchPlayers}
        />
        <div className="mt-3 space-y-3">
          <StreamStartModal matchId={match.id} currentStatus={match.streamStatus} />
          <ScorerAssign matchId={match.id} currentScorerId={match.scorerId} />
        </div>
      </MotionWrapper>

      {/* Scorecards */}
      <MotionWrapper variant="fadeInUp" delay={0.2}>
        {innings.length === 0 ? (
          <Card className="border-none shadow-lg bg-card/50 backdrop-blur-md">
            <CardContent className="py-12 text-center text-muted-foreground">
              <Trophy className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="font-semibold text-lg">No Scorecard Available Yet</p>
              <p className="text-sm mt-1">This match has not started. Scorecard details will appear once the match is live.</p>
            </CardContent>
          </Card>
        ) : (
          <Tabs defaultValue="innings1" className="space-y-4">
            <TabsList>
              <TabsTrigger value="innings1">{teamA.name} Innings</TabsTrigger>
              {innings.length > 1 && <TabsTrigger value="innings2">{teamB.name} Innings</TabsTrigger>}
            </TabsList>

            {innings.map((inn, idx) => (
              <TabsContent key={idx} value={`innings${idx + 1}`} className="space-y-4">
                {/* Batting */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Batting — {inn.team} ({inn.score})</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b text-muted-foreground text-xs">
                            <th className="py-2 text-left font-medium">Batter</th>
                            <th className="py-2 text-left font-medium">Dismissal</th>
                            <th className="py-2 text-center font-medium">R</th>
                            <th className="py-2 text-center font-medium">B</th>
                            <th className="py-2 text-center font-medium">4s</th>
                            <th className="py-2 text-center font-medium">6s</th>
                            <th className="py-2 text-center font-medium">SR</th>
                          </tr>
                        </thead>
                        <tbody>
                          {inn.batting.map((b, i) => (
                            <tr key={i} className="border-b last:border-0 hover:bg-muted/20">
                              <td className="py-2 font-medium">{b.name}</td>
                              <td className="py-2 text-muted-foreground text-xs">{b.dismissal}</td>
                              <td className="py-2 text-center tabular-nums font-semibold">{b.runs}</td>
                              <td className="py-2 text-center tabular-nums">{b.balls}</td>
                              <td className="py-2 text-center tabular-nums">{b.fours}</td>
                              <td className="py-2 text-center tabular-nums">{b.sixes}</td>
                              <td className="py-2 text-center tabular-nums">{b.sr}</td>
                            </tr>
                          ))}
                          {inn.batting.length === 0 && (
                            <tr>
                              <td colSpan={7} className="py-4 text-center text-muted-foreground text-sm">
                                No batting records found for this innings.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">Extras: {inn.extras}</p>
                  </CardContent>
                </Card>

                {/* Bowling */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg">Bowling</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b text-muted-foreground text-xs">
                            <th className="py-2 text-left font-medium">Bowler</th>
                            <th className="py-2 text-center font-medium">O</th>
                            <th className="py-2 text-center font-medium">M</th>
                            <th className="py-2 text-center font-medium">R</th>
                            <th className="py-2 text-center font-medium">W</th>
                            <th className="py-2 text-center font-medium">Econ</th>
                          </tr>
                        </thead>
                        <tbody>
                          {inn.bowling.map((b, i) => (
                            <tr key={i} className="border-b last:border-0 hover:bg-muted/20">
                              <td className="py-2 font-medium">{b.name}</td>
                              <td className="py-2 text-center tabular-nums">{b.overs}</td>
                              <td className="py-2 text-center tabular-nums">{b.maidens}</td>
                              <td className="py-2 text-center tabular-nums">{b.runs}</td>
                              <td className="py-2 text-center tabular-nums font-semibold">{b.wickets}</td>
                              <td className="py-2 text-center tabular-nums">{b.economy}</td>
                            </tr>
                          ))}
                          {inn.bowling.length === 0 && (
                            <tr>
                              <td colSpan={6} className="py-4 text-center text-muted-foreground text-sm">
                                No bowling records found for this innings.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            ))}
          </Tabs>
        )}
      </MotionWrapper>
    </div>
  )
}
