import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@mtk/ui/components/ui/card"
import { Badge } from "@mtk/ui/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@mtk/ui/components/ui/tabs"
import { Trophy, Video } from "lucide-react"
import { db, matches, teams, matchInnings, players, venues, battingScorecards, bowlingScorecards, matchBalls } from "@mtk/database"
import { eq, and, asc, inArray } from "drizzle-orm"
import { notFound } from "next/navigation"
import { unstable_noStore as noStore } from "next/cache"
import { ShareButton } from "@/components/share/share-button"
import { PrintButton } from "@/components/share/print-button"
import { requirePublicTenantId } from "@/lib/public-tenant"

export default async function PublicMatchPage({ params }: { params: Promise<{ matchId: string }> }) {
  noStore()
  const { matchId } = await params

  // Tenant-scoped: this route is unauthenticated, so the match must be proven to
  // belong to the tenant that owns the request host. Without this, any holder of
  // a match UUID could read another tenant's scorecard.
  const tenantId = await requirePublicTenantId()

  const [match] = await db.select().from(matches)
    .where(and(eq(matches.id, matchId), eq(matches.tenantId, tenantId)))
    .limit(1)
  if (!match) notFound()

  const [teamA] = await db.select().from(teams).where(and(eq(teams.id, match.teamAId), eq(teams.tenantId, tenantId))).limit(1)
  const [teamB] = await db.select().from(teams).where(and(eq(teams.id, match.teamBId), eq(teams.tenantId, tenantId))).limit(1)
  if (!teamA || !teamB) notFound()

  let venueName = "TBD Venue"
  if (match.venueId) {
    const [venue] = await db.select().from(venues).where(and(eq(venues.id, match.venueId), eq(venues.tenantId, tenantId))).limit(1)
    if (venue) venueName = `${venue.name}, ${venue.city}`
  }

  let momName = ""
  if (match.manOfMatchId) {
    const [p] = await db.select({ name: players.name }).from(players).where(and(eq(players.id, match.manOfMatchId), eq(players.tenantId, tenantId))).limit(1)
    momName = p?.name ?? ""
  }

  const inningsRaw = await db.select().from(matchInnings)
    .where(and(eq(matchInnings.matchId, matchId), eq(matchInnings.tenantId, tenantId)))
    .orderBy(asc(matchInnings.inningsNumber))

  const [battingAll, bowlingAll] = await Promise.all([
    db.select().from(battingScorecards).where(and(eq(battingScorecards.matchId, matchId), eq(battingScorecards.tenantId, tenantId))),
    db.select().from(bowlingScorecards).where(and(eq(bowlingScorecards.matchId, matchId), eq(bowlingScorecards.tenantId, tenantId))),
  ])

  const wicketBalls = await db.select().from(matchBalls)
    .where(and(eq(matchBalls.matchId, matchId), eq(matchBalls.tenantId, tenantId)))

  const playerIds = Array.from(new Set([
    ...battingAll.map(b => b.playerId),
    ...battingAll.map(b => b.bowlerId).filter((x): x is string => !!x),
    ...battingAll.map(b => b.fielderId).filter((x): x is string => !!x),
    ...bowlingAll.map(b => b.playerId),
    ...wicketBalls.map(b => b.batsmanId).filter((x): x is string => !!x),
    ...wicketBalls.map(b => b.bowlerId).filter((x): x is string => !!x),
  ]))
  const playerRows = playerIds.length
    ? await db.select({ id: players.id, name: players.name }).from(players)
        .where(and(inArray(players.id, playerIds), eq(players.tenantId, tenantId)))
    : []
  const nameById = new Map(playerRows.map(p => [p.id, p.name]))

  const fowByInnings = new Map<string, { over: string; batsman: string; bowler: string; scoreAtFall: number; wicketsAtFall: number }[]>()
  {
    const ballsByInnings = new Map<string, typeof wicketBalls>()
    for (const b of wicketBalls) {
      const arr = ballsByInnings.get(b.inningsId) ?? []
      arr.push(b)
      ballsByInnings.set(b.inningsId, arr)
    }
    for (const [inningsId, balls] of ballsByInnings) {
      const sorted = [...balls].sort((a, b) => a.ballSequence - b.ballSequence || (a.overNumber - b.overNumber) || (a.ballNumber - b.ballNumber))
      let runs = 0
      let wickets = 0
      const rows: { over: string; batsman: string; bowler: string; scoreAtFall: number; wicketsAtFall: number }[] = []
      for (const b of sorted) {
        runs += b.runs
        if (b.isWicket) {
          wickets += 1
          rows.push({
            over: `${b.overNumber}.${b.ballNumber}`,
            batsman: b.batsmanId ? nameById.get(b.batsmanId) ?? "Unknown" : "Unknown",
            bowler: b.bowlerId ? nameById.get(b.bowlerId) ?? "" : "",
            scoreAtFall: runs,
            wicketsAtFall: wickets,
          })
        }
      }
      fowByInnings.set(inningsId, rows)
    }
  }

  const innings = inningsRaw.map((inn) => {
    const batting = battingAll
      .filter(b => b.inningsId === inn.id)
      .sort((a, b) => a.battingPosition - b.battingPosition)
      .map(b => {
        const bowlerName = b.bowlerId ? nameById.get(b.bowlerId) ?? "" : ""
        const fielderName = b.fielderId ? nameById.get(b.fielderId) ?? "" : ""
        let dismissalText = b.dismissalText || ""
        if (!dismissalText && b.dismissalType && b.dismissalType !== "not_out") {
          if (b.dismissalType === "bowled") dismissalText = `b ${bowlerName}`
          else if (b.dismissalType === "caught") dismissalText = `c ${fielderName} b ${bowlerName}`
          else if (b.dismissalType === "caught_behind") dismissalText = `c ${fielderName} b ${bowlerName}`
          else if (b.dismissalType === "caught_and_bowled") dismissalText = `c & b ${bowlerName}`
          else if (b.dismissalType === "lbw") dismissalText = `lbw b ${bowlerName}`
          else if (b.dismissalType === "run_out") dismissalText = `run out (${fielderName})`
          else if (b.dismissalType === "stumped") dismissalText = `stumped ${fielderName} b ${bowlerName}`
          else dismissalText = b.dismissalType.replace(/_/g, " ")
        } else if (b.dismissalType === "not_out") dismissalText = "not out"
        return {
          name: nameById.get(b.playerId) ?? "Unknown Player",
          dismissal: dismissalText,
          runs: b.runs,
          balls: b.ballsFaced,
          fours: b.fours,
          sixes: b.sixes,
          sr: b.strikeRate ? Number(b.strikeRate).toFixed(2) : "0.00",
        }
      })
    const bowling = bowlingAll
      .filter(b => b.inningsId === inn.id)
      .sort((a, b) => a.bowlingPosition - b.bowlingPosition)
      .map(b => ({
        name: nameById.get(b.playerId) ?? "Unknown Player",
        overs: b.overs ? Number(b.overs).toFixed(1) : "0.0",
        maidens: b.maidens,
        runs: b.runsConceded,
        wickets: b.wickets,
        economy: b.economyRate ? Number(b.economyRate).toFixed(2) : "0.00",
      }))
    const battingTeam = inn.teamId === teamA.id ? teamA : teamB
    const totalOversPlayed = Math.floor(inn.totalBalls / 6) + (inn.totalBalls % 6) / 10
    return {
      team: battingTeam.name,
      score: `${inn.totalRuns}/${inn.totalWickets}`,
      overs: totalOversPlayed.toFixed(1),
      batting,
      bowling,
      extras: `${inn.extras} (w ${inn.wides}, nb ${inn.noBalls}, b ${inn.byes}, lb ${inn.legByes})`,
      inningsId: inn.id,
    }
  })

  const teamAColor = teamA.primaryColor || "#2D8B4E"
  const teamBColor = teamB.primaryColor || "#E74C3C"
  const teamAShort = teamA.shortName || teamA.name.substring(0, 3).toUpperCase()
  const teamBShort = teamB.shortName || teamB.name.substring(0, 3).toUpperCase()
  const formattedDate = match.scheduledDate
    ? new Date(match.scheduledDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : "TBD"
  const formatText = match.matchFormat ? match.matchFormat.toUpperCase() : "T20"
  const resultText = match.result || (match.status === "live" ? "Match is Live" : match.status === "scheduled" ? "Scheduled" : match.status.toUpperCase())
  const teamAInnings = innings.find(inn => inn.team === teamA.name)
  const teamBInnings = innings.find(inn => inn.team === teamB.name)

  return (
    <div className="max-w-4xl mx-auto space-y-6 p-4">
      <Card className="overflow-hidden border-none shadow-xl relative text-white">
        <div className="absolute inset-0 z-0" style={{ background: `linear-gradient(135deg, ${teamAColor}, ${teamBColor})`, opacity: 0.85 }} />
        <div className="absolute inset-0 z-0 bg-black/20" />
        <CardContent className="pt-8 pb-6 relative z-10">
          <div className="flex items-center justify-between mb-6">
            <Badge variant="outline" className="text-xs border-white/30 text-white bg-white/10">{formatText} · {venueName}</Badge>
            <div className="flex items-center gap-2">
              <ShareButton matchId={matchId} teamAName={teamA.name} teamBName={teamB.name} resultText={resultText} />
              <PrintButton href={`/api/scorecards/${matchId}/pdf`} />
              <Badge variant="outline" className="text-xs border-white/30 text-white bg-white/10">{formattedDate}</Badge>
            </div>
          </div>
          <div className="flex items-center justify-between gap-4">
            <div className="text-center flex-1">
              <div className="h-16 w-16 rounded-2xl mx-auto flex items-center justify-center text-white font-bold text-xl mb-3 border-2 border-white/20" style={{ backgroundColor: teamAColor }}>{teamAShort}</div>
              <p className="font-bold text-base text-white">{teamA.name}</p>
              {teamAInnings ? <>
                <p className="text-3xl font-bold tabular-nums mt-1 text-white">{teamAInnings.score}</p>
                <p className="text-sm text-white/70">({teamAInnings.overs} ov)</p>
              </> : <p className="text-xl font-bold mt-2 text-white/50">TBD</p>}
            </div>
            <div className="text-center px-4"><p className="text-xs text-white/50 font-bold tracking-widest uppercase">VS</p></div>
            <div className="text-center flex-1">
              <div className="h-16 w-16 rounded-2xl mx-auto flex items-center justify-center text-white font-bold text-xl mb-3 border-2 border-white/20" style={{ backgroundColor: teamBColor }}>{teamBShort}</div>
              <p className="font-bold text-base text-white">{teamB.name}</p>
              {teamBInnings ? <>
                <p className="text-3xl font-bold tabular-nums mt-1 text-white">{teamBInnings.score}</p>
                <p className="text-sm text-white/70">({teamBInnings.overs} ov)</p>
              </> : <p className="text-xl font-bold mt-2 text-white/50">TBD</p>}
            </div>
          </div>
          <div className="mt-6 pt-4 border-t border-white/20 text-center">
            <p className="text-base font-bold text-white tracking-wide">{resultText}</p>
            {momName && <p className="text-sm mt-2 flex items-center justify-center gap-1.5">
              <Trophy className="h-4 w-4 text-yellow-400" />
              <span className="text-white/80">Player of the Match:</span>
              <span className="font-bold text-white">{momName}</span>
            </p>}
            {match.streamStatus === "live" && (
              <Link href={`/matches/${matchId}/live`} className="inline-flex items-center gap-1.5 mt-3 text-sm font-semibold text-white bg-red-600 rounded-full px-4 py-1.5">
                <Video className="h-4 w-4" /> Watch Live
              </Link>
            )}
          </div>
        </CardContent>
      </Card>

      {innings.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Trophy className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p className="font-semibold text-lg">No Scorecard Available Yet</p>
            <p className="text-sm mt-1">Scorecard details will appear once the match starts.</p>
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
              <Card>
                <CardHeader><CardTitle className="text-lg">Batting — {inn.team} ({inn.score})</CardTitle></CardHeader>
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
                          <tr><td colSpan={7} className="py-4 text-center text-muted-foreground text-sm">No batting records found.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">Extras: {inn.extras}</p>
                  {fowByInnings.get(inn.inningsId)?.length ? (
                    <div className="mt-3">
                      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Fall of Wickets</h4>
                      <p className="text-xs text-muted-foreground">
                        {fowByInnings.get(inn.inningsId)!.map((f, i) => (
                          <span key={i}>
                            {f.wicketsAtFall}-{f.scoreAtFall} ({f.batsman}, {f.over} ov){i < fowByInnings.get(inn.inningsId)!.length - 1 ? ", " : ""}
                          </span>
                        ))}
                      </p>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="text-lg">Bowling</CardTitle></CardHeader>
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
                          <tr><td colSpan={6} className="py-4 text-center text-muted-foreground text-sm">No bowling records found.</td></tr>
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
    </div>
  )
}
