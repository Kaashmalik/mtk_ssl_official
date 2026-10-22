import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@mtk/ui/components/ui/card"
import { Badge } from "@mtk/ui/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@mtk/ui/components/ui/tabs"
import { Trophy, Video } from "lucide-react"
import { db, matchInnings, players, venues, battingScorecards, bowlingScorecards, matchBalls } from "@mtk/database"
import { eq, and, asc, inArray } from "drizzle-orm"
import { notFound } from "next/navigation"
import { unstable_noStore as noStore } from "next/cache"
import { ShareButton } from "@/components/share/share-button"
import { PrintButton } from "@/components/share/print-button"
import { AiSummaryCard } from "@/components/matches/ai-summary-card"
import { matchSummaryAiReady } from "@/lib/match-summary-ai"
import { requirePublicTenantId } from "@/lib/public-tenant"
import { readPublishedMatch, readPublishedMatchTeams } from "@/lib/public-visibility"
import { readPublishedMatchPlayback } from "@/lib/broadcast-playback"
import type { FanReactionType } from "@mtk/database/lib/fan-reaction-policy"
import { readFanReactionCounts, readMyFanReactions } from "@/lib/fan-reactions"
import { MatchReactionBar } from "@/components/shared/match-reaction-bar"
import { ReactionFeedReport } from "@/components/shared/reaction-feed-report"
import { getTranslations } from "next-intl/server"
import { applyMinorNameGate } from "@mtk/database/lib/minor-consent-policy"
import { deriveMatchRecap } from "@mtk/database/lib/match-recap"
import { deriveInningsOverlay, type OverlayBallKind } from "@mtk/database/lib/match-overlays"

export default async function PublicMatchPage({ params }: { params: Promise<{ matchId: string }> }) {
  noStore()
  const { matchId } = await params

  // Tenant-scoped AND publication-gated: this route is unauthenticated, so the
  // match must belong to the tenant that owns the request host and be published
  // (not cancelled, and not part of a draft competition). Otherwise 404.
  const tenantId = await requirePublicTenantId()
  const match = await readPublishedMatch(tenantId, matchId)
  if (!match) notFound()

  const { teamA, teamB } = await readPublishedMatchTeams(tenantId, match)
  if (!teamA || !teamB) notFound()
  // ENH-08-03: Live/Replay badges come from the truthful provider catalogue,
  // not from a raw stream-status column. When the verified broadcast plane is
  // not enabled this still allows a legacy live embed, but never invents a
  // replay.
  const playback = await readPublishedMatchPlayback(tenantId, match)

    // FAN-01: engagement-only reactions on this published match. Counts are
  // public and aggregate (never per-fan); the viewer's own rows fail closed to
  // an empty set for an unauthenticated or non-fan visit - never an error page.
  // A successful fan-context read also proves the viewer CAN report the feed
  // (identity is the report gate; the writer re-checks publication itself).
  const reactionCounts = await readFanReactionCounts(tenantId, matchId)
  let myReactions: FanReactionType[] = []
  let canReportFeed = false
  try {
    myReactions = await readMyFanReactions(tenantId, matchId)
    canReportFeed = true
  } catch {
    myReactions = []
  }

  let venueName = "TBD Venue"
  if (match.venueId) {
    const [venue] = await db.select({ name: venues.name, city: venues.city }).from(venues).where(and(eq(venues.id, match.venueId), eq(venues.tenantId, tenantId))).limit(1)
    if (venue) venueName = `${venue.name}, ${venue.city}`
  }

  let momName = ""
  if (match.manOfMatchId) {
    const [p] = await db.select({ id: players.id, name: players.name, dateOfBirth: players.dateOfBirth, guardianConsentAt: players.guardianConsentAt }).from(players).where(and(eq(players.id, match.manOfMatchId), eq(players.tenantId, tenantId))).limit(1)
    // PUB-06 (Batch 133): the player-of-the-match name passes the same gate.
    if (p) momName = applyMinorNameGate([p]).get(p.id) ?? ""
  }

  // PUB-06/PUB-02: explicit columns only on this unauthenticated page - the
  // internal scorecard plumbing (matchBalls.clientOpId sync keys, tenant
  // refs) never loads. All fields listed are what the card renders.
  const inningsRaw = await db.select({
    id: matchInnings.id,
    teamId: matchInnings.teamId,
    inningsNumber: matchInnings.inningsNumber,
    totalRuns: matchInnings.totalRuns,
    totalBalls: matchInnings.totalBalls,
    totalWickets: matchInnings.totalWickets,
    extras: matchInnings.extras,
    wides: matchInnings.wides,
    noBalls: matchInnings.noBalls,
    byes: matchInnings.byes,
    legByes: matchInnings.legByes,
  }).from(matchInnings)
    .where(and(eq(matchInnings.matchId, matchId), eq(matchInnings.tenantId, tenantId)))
    .orderBy(asc(matchInnings.inningsNumber))

  const [battingAll, bowlingAll] = await Promise.all([
    db.select({
      inningsId: battingScorecards.inningsId,
      battingPosition: battingScorecards.battingPosition,
      playerId: battingScorecards.playerId,
      bowlerId: battingScorecards.bowlerId,
      fielderId: battingScorecards.fielderId,
      dismissalType: battingScorecards.dismissalType,
      dismissalText: battingScorecards.dismissalText,
      runs: battingScorecards.runs,
      ballsFaced: battingScorecards.ballsFaced,
      fours: battingScorecards.fours,
      sixes: battingScorecards.sixes,
      strikeRate: battingScorecards.strikeRate,
    }).from(battingScorecards).where(and(eq(battingScorecards.matchId, matchId), eq(battingScorecards.tenantId, tenantId))),
    db.select({
      inningsId: bowlingScorecards.inningsId,
      bowlingPosition: bowlingScorecards.bowlingPosition,
      playerId: bowlingScorecards.playerId,
      overs: bowlingScorecards.overs,
      maidens: bowlingScorecards.maidens,
      runsConceded: bowlingScorecards.runsConceded,
      wickets: bowlingScorecards.wickets,
      economyRate: bowlingScorecards.economyRate,
    }).from(bowlingScorecards).where(and(eq(bowlingScorecards.matchId, matchId), eq(bowlingScorecards.tenantId, tenantId))),
  ])

  const wicketBalls = await db.select({
    inningsId: matchBalls.inningsId,
    ballSequence: matchBalls.ballSequence,
    overNumber: matchBalls.overNumber,
    ballNumber: matchBalls.ballNumber,
    runs: matchBalls.runs,
    isWicket: matchBalls.isWicket,
    batsmanId: matchBalls.batsmanId,
    bowlerId: matchBalls.bowlerId,
  }).from(matchBalls)
    .where(and(eq(matchBalls.matchId, matchId), eq(matchBalls.tenantId, tenantId)))

  const playerIds = Array.from(new Set([
    ...battingAll.map(b => b.playerId),
    ...battingAll.map(b => b.bowlerId).filter((x): x is string => !!x),
    ...battingAll.map(b => b.fielderId).filter((x): x is string => !!x),
    ...bowlingAll.map(b => b.playerId),
    ...wicketBalls.map(b => b.batsmanId).filter((x): x is string => !!x),
    ...wicketBalls.map(b => b.bowlerId).filter((x): x is string => !!x),
  ]))
  // PUB-06 (Batch 133 closure): the scorecard is an official record, so a
  // proven minor's IDENTITY is withheld, not their stat row - the team total
  // must keep adding up. The gate is the same pure policy the leaderboards
  // use; a viewer only ever sees WITHHELD_NAME_LABEL in place of the name.
  const playerRows = playerIds.length
    ? await db.select({ id: players.id, name: players.name, dateOfBirth: players.dateOfBirth, guardianConsentAt: players.guardianConsentAt }).from(players)
        .where(and(inArray(players.id, playerIds), eq(players.tenantId, tenantId)))
    : []
  const nameById = applyMinorNameGate(playerRows)

  // Shared ball-row grouping (SCORE-13, Batch 137): the FoW attribution and
  // the Match Center overlays fold over the SAME recorded rows - no second
  // read, no divergent orderings.
  const ballsByInnings = new Map<string, typeof wicketBalls>()
  for (const b of wicketBalls) {
    const arr = ballsByInnings.get(b.inningsId) ?? []
    arr.push(b)
    ballsByInnings.set(b.inningsId, arr)
  }
  const fowByInnings = new Map<string, { over: string; batsman: string; bowler: string; scoreAtFall: number; wicketsAtFall: number }[]>()
  {
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

  // FAN-03 (Batch 133): the recap derives ONLY from the official rows this
  // page already loaded and publication-gated - it is a deterministic view,
  // never a narrative. With no innings there is no recap and the section
  // simply does not render. Names arrive already minor-gated via nameById.
  const recap = deriveMatchRecap({
    resultText,
    manOfMatchName: momName || null,
    innings: inningsRaw.map((inn, idx) => ({
      teamName: innings[idx].team,
      totalRuns: inn.totalRuns,
      totalWickets: inn.totalWickets,
      totalBalls: inn.totalBalls,
      batting: innings[idx].batting.map(b => ({ name: b.name, runs: b.runs, balls: b.balls })),
      bowling: innings[idx].bowling.map(b => ({ name: b.name, wickets: b.wickets, runs: b.runs, overs: Number(b.overs) || 0 })),
    })),
  })

  // SCORE-13 (Batch 137): Match Center overlays per innings - partnership
  // and recent-balls folded over the SAME recorded ball rows the FoW map
  // used. Zero new reads; counts are RECORDED deliveries (the policy never
  // claims legality it cannot see), and innings with no rows render no
  // strip at all.
  const overlays = inningsRaw.map(inn => deriveInningsOverlay(ballsByInnings.get(inn.id) ?? []))
  // UX-03 (Batch 139): the strip's labels render through the message
  // dictionary (the policy's basis comes back as a KEY, not a sentence);
  // the English policy labels remain the canonical fallback record.
  const tMC = await getTranslations("matchCenter")
  // FAN-04 (Batch 143): the recap card rides the matchRecap dictionary the
  // same way - bounded keys, English RECAP_LABELS in the policy remain the
  // canonical fallback record, and the derivedNotice is rendered WITH the
  // recap, always.
  const tRecap = await getTranslations("matchRecap")
  const chipTone: Record<OverlayBallKind, string> = {
    dot: "bg-muted text-muted-foreground",
    run: "bg-muted text-foreground",
    four: "bg-sky-600 text-white",
    six: "bg-violet-600 text-white",
    wicket: "bg-red-600 text-white",
  }

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
          <MatchReactionBar matchId={matchId} initialCounts={reactionCounts} initialMine={myReactions} />
          {canReportFeed ? <ReactionFeedReport matchId={matchId} /> : null}
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
            {(playback.state === "live" || playback.state === "replay") && (
              <Link href={`/matches/${matchId}/live`} className={`inline-flex items-center gap-1.5 mt-3 text-sm font-semibold text-white rounded-full px-4 py-1.5 ${playback.state === "live" ? "bg-red-600" : "bg-slate-700"}`}>
                <Video className="h-4 w-4" /> {playback.state === "live" ? "Watch Live" : "Watch Replay"}
              </Link>
            )}
          </div>
        </CardContent>
      </Card>

      {recap && (
        <Card data-testid="match-recap">
          <CardHeader><CardTitle className="text-lg">{tRecap("title")}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm font-medium">{recap.summary}</p>
            {(recap.topBatters.length > 0 || recap.topBowlers.length > 0) && (
              <div className="grid gap-2 sm:grid-cols-2 text-sm">
                {recap.topBatters.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{tRecap("topBatters")}</p>
                    {recap.topBatters.map((row, i) => (
                      <p key={`b${i}`} className="tabular-nums">{row.playerName} — {row.runs} ({row.balls}b)</p>
                    ))}
                  </div>
                )}
                {recap.topBowlers.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{tRecap("topBowlers")}</p>
                    {recap.topBowlers.map((row, i) => (
                      <p key={`w${i}`} className="tabular-nums">{row.playerName} — {row.wickets}/{row.runs} ({row.overs} ov)</p>
                    ))}
                  </div>
                )}
              </div>
            )}
            {recap.moments.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">{tRecap("moments")}</p>
                <ul className="text-sm space-y-1">
                  {recap.moments.map((moment, i) => (
                    <li key={i}>
                      <span className="font-semibold">{tRecap(`momentLabels.${moment.kind}`)}</span> {moment.playerName} — {moment.detail}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="text-xs text-muted-foreground">{tRecap("derivedNotice")}</p>
          </CardContent>
        </Card>
      )}

      {/* FAN-04 (B163): the gated AI summary. The server ships this client
          card ONLY when MATCH_SUMMARY_AI_READY is enabled - an ungated
          deployment never loads the code, never makes the request. The card
          always renders its AI/derived label with the never-fabricated
          notice; it derives from the same official rows and never changes
          official scores. */}
      {recap && matchSummaryAiReady() && <AiSummaryCard matchId={matchId} />}

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
              {overlays[idx] && (
                <Card>
                  <CardContent className="py-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                    <span>
                      <span className="font-semibold">{tMC("partnership")}</span>{" "}
                      {overlays[idx]!.partnershipRuns} ({overlays[idx]!.partnershipDeliveries}{" "}
                      {tMC("recordedDeliveries")}, {tMC(overlays[idx]!.partnershipBasis)})
                    </span>
                    {overlays[idx]!.lastWicketAt && (
                      <span className="text-muted-foreground text-xs">
                        {tMC("lastWicket")}: {overlays[idx]!.lastWicketAt}
                      </span>
                    )}
                    <span className="ml-auto flex gap-1" aria-label={tMC("recentBalls")}>
                      {overlays[idx]!.recent.map((chip, i) => (
                        <span
                          key={i}
                          title={chip.title}
                          className={`inline-flex h-6 min-w-6 items-center justify-center rounded px-1 text-xs font-bold ${chipTone[chip.kind]}`}
                        >
                          {chip.marker}
                        </span>
                      ))}
                    </span>
                  </CardContent>
                </Card>
              )}
              <Card>
                <CardHeader><CardTitle className="text-lg">Batting — {inn.team} ({inn.score})</CardTitle></CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-muted-foreground text-xs">
                          <th className="py-2 text-start font-medium">Batter</th>
                          <th className="py-2 text-start font-medium">Dismissal</th>
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
                          <th className="py-2 text-start font-medium">Bowler</th>
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
