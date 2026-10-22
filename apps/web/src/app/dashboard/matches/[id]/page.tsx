import React from "react"
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
import { BroadcastOverlayButton } from "@/components/broadcast/broadcast-overlay-button"
import { ScorerAssign } from "@/components/matches/scorer-assign"
import { ScorerApprovalButton } from "@/components/matches/scorer-approval-button"
import { UmpireAssign } from "@/components/matches/umpire-assign"
import { UmpireApprovalButton } from "@/components/matches/umpire-approval-button"
import { PlayingXiCard } from "@/components/matches/playing-xi-card"
import { MatchReadinessCard } from "@/components/matches/readiness-card"
import { MatchControlCard } from "@/components/matches/match-control-card"
import { ReactionModerationCard } from "@/components/matches/reaction-moderation-card"
import { readMatchReactionsForModeration } from "@/lib/fan-reaction-moderation"
import { readOpenReactionReports } from "@/lib/fan-report-records"
import { readActiveFanBlocks } from "@/lib/fan-block-records"
import { readMatchAvailabilitySummary, readMyAvailability } from "@/lib/match-availability"
import { readMatchCorrectionRequests } from "@/lib/scorecard-corrections"
import { readBroadcastControlData } from "@/lib/broadcast-sessions"
import type { BroadcastControlData } from "@mtk/contracts"
import { AvailabilityCard, type AvailabilityAnswer } from "@/components/matches/availability-card"
import { MatchPredictionCard } from "@/components/matches/prediction-card"
import { readMyPredictionView } from "@/lib/fan-predictions"
import { CorrectionRequestCard, type CorrectionEntry } from "@/components/matches/correction-request-card"
import { getFullScorecard } from "@/app/actions/scorecards"
import { ShareButton } from "@/components/share/share-button"
import { auth } from "@clerk/nextjs/server"
import { db, teams, matchInnings, players, venues, leagueRegistrations, users, userTenantRoles, matchPlayingXis } from "@mtk/database"
import { and, eq, asc, inArray, isNull } from "drizzle-orm"
import { notFound } from "next/navigation"
import { unstable_noStore as noStore } from "next/cache"
import { matchRegistrationMap } from "@mtk/database/lib/registered-squad-eligibility"

export default async function MatchDetailPage({ params }: { params: Promise<{ id: string }> }) {
  noStore()
  const { id } = await params
  
  const match = await getMatch(id)
  if (!match) {
    notFound()
  }

  // Official consent (COMP-06) + declared-XI surfaces (Batch 81): resolve
  // whether the viewer occupies a pending scorer/umpire slot or may declare /
  // approve XIs, so only they see the controls. The writers re-verify
  // authority under a lock; these reads only size the buttons.
  let viewerOccupiesScorerSlot = false
  let viewerOccupiesUmpireSlot = false
  let viewerCanDeclareXis = false
  let viewerCanApproveXis = false
  let viewerCanSubstituteXi = false
let viewerIsLeagueOwner = false
  const xiSurfacesRelevant = Boolean(match.tournamentId)
    && (match.status === "scheduled" || Boolean(match.xiRequired && !match.xiApprovedAt))
    || Boolean(match.tournamentId && match.xiRequired
      && ["scheduled", "toss", "live", "innings_break"].includes(match.status ?? ""))
  if ((match.scorerApprovalRequired && !match.scorerApprovedAt)
    || (match.umpireApprovalRequired && !match.umpireApprovedAt)
    || xiSurfacesRelevant) {
    const { userId: viewerClerkId } = await auth()
    if (viewerClerkId) {
      const [viewer] = await db.select({ id: users.id }).from(users)
        .where(and(eq(users.clerkId, viewerClerkId), eq(users.isActive, true))).limit(1)
      if (viewer) {
        if (match.scorerId === viewer.id || match.backupScorerId === viewer.id) viewerOccupiesScorerSlot = true
        if (match.umpire1Id === viewer.id || match.umpire2Id === viewer.id) viewerOccupiesUmpireSlot = true
        if (xiSurfacesRelevant) {
          const [membership] = await db.select({ role: userTenantRoles.role }).from(userTenantRoles)
            .where(and(eq(userTenantRoles.userId, viewer.id), eq(userTenantRoles.tenantId, match.tenantId))).limit(1)
          viewerCanDeclareXis = match.status === "scheduled"
            && (membership?.role === "league_owner" || viewerOccupiesScorerSlot)
          viewerCanApproveXis = Boolean(match.xiRequired && !match.xiApprovedAt)
            && (membership?.role === "league_owner" || viewerOccupiesUmpireSlot)
          viewerCanSubstituteXi = Boolean(match.xiRequired)
            && ["scheduled", "toss", "live", "innings_break"].includes(match.status ?? "")
            && (membership?.role === "league_owner" || viewerOccupiesUmpireSlot)
          viewerIsLeagueOwner = membership?.role === "league_owner"
        }
      }
    }
  }

  // REG-05 (Batch 138): the availability journey state - the viewer's own
  // recorded answer and the league's bounded answers list (last-recorded
  // facts, updated in place). The WRITE re-verifies active membership in
  // this match's league under a lock; these reads only size the card.
  const availabilityView = await readMyAvailability(id, match.tenantId)
  const availabilityAnswers: AvailabilityAnswer[] = await readMatchAvailabilitySummary(id, match.tenantId)
  // REG-05 (Batch 141): correction-request state - the owner authority read
  // and the match's bounded request list. The writers re-verify membership
  // and owner authority under locks; these reads only size the card.
  let viewerLeagueOwner = false
  if (availabilityView.userId) {
    const [viewerMember] = await db.select({ role: userTenantRoles.role })
      .from(userTenantRoles)
      .where(and(eq(userTenantRoles.userId, availabilityView.userId), eq(userTenantRoles.tenantId, match.tenantId)))
      .limit(1)
    viewerLeagueOwner = viewerMember?.role === "league_owner"
  }
  // Broadcast control data is owner-only. A read failure (for example before
  // the additive migration is applied) falls back to the manual link path
  // instead of failing the match page.
  let broadcastControl: BroadcastControlData | undefined
  if (viewerLeagueOwner) {
    try {
      broadcastControl = await readBroadcastControlData(match.tenantId, match.id)
    } catch {
      broadcastControl = undefined
    }
  }
  const correctionRequests = await readMatchCorrectionRequests(id, match.tenantId)
  const myOpenRequest = availabilityView.userId
    ? correctionRequests.find(r => r.requestedBy === availabilityView.userId && r.status === "open") ?? null
    : null

  // Fetch Team A details
  const [teamA] = await db.select().from(teams).where(and(eq(teams.id, match.teamAId), eq(teams.tenantId, match.tenantId))).limit(1)
  // Fetch Team B details
  const [teamB] = await db.select().from(teams).where(and(eq(teams.id, match.teamBId), eq(teams.tenantId, match.tenantId))).limit(1)

  // FAN-04 (Batch 164): the prediction card state - the viewer's pick plus
  // the DERIVED verdict from the official row. The read only sizes the
  // card; the write re-verifies session, membership and window under a
  // transaction.
  const predictionView = await readMyPredictionView(
    id,
    match.tenantId,
    availabilityView.userId || null,
    teamA?.name ?? "Home team",
    teamB?.name ?? "Away team",
  )

  // FAN-01 owner moderation: individual reaction rows are only ever surfaced
  // here, to the league owner, bounded newest-first. Fail closed to empty -
  // a moderation read failure is never a page failure.
  let moderatableReactions: Awaited<ReturnType<typeof readMatchReactionsForModeration>> = []
  let openReactionReports: Awaited<ReturnType<typeof readOpenReactionReports>> = []
  let activeFanBlocks: Awaited<ReturnType<typeof readActiveFanBlocks>> = []
  if (viewerIsLeagueOwner) {
    try {
      moderatableReactions = await readMatchReactionsForModeration(id)
    } catch {
      moderatableReactions = []
    }
    // FAN-01 reports slice: the owner's open fan reports for this match,
    // same fail-closed posture - a read failure is never a page failure.
    try {
      openReactionReports = await readOpenReactionReports(id)
    } catch {
      openReactionReports = []
    }
    // FAN-01 anti-abuse slice: the league's currently blocked fans (the
    // block surface is league-scoped, so this is independent of the match id).
    try {
      activeFanBlocks = await readActiveFanBlocks()
    } catch {
      activeFanBlocks = []
    }
  }

  if (!teamA || !teamB) {
    notFound()
  }

  // Fetch Venue details
  let venueName = "TBD Venue"
  if (match.venueId) {
    const [venue] = await db.select().from(venues).where(and(eq(venues.id, match.venueId), eq(venues.tenantId, match.tenantId))).limit(1)
    if (venue) {
      venueName = `${venue.name}, ${venue.city}`
    }
  }

  // Fetch Man of the Match details
  let momName = ""
  if (match.manOfMatchId) {
    const [momPlayer] = await db.select().from(players).where(and(eq(players.id, match.manOfMatchId), eq(players.tenantId, match.tenantId))).limit(1)
    if (momPlayer) {
      momName = momPlayer.name
    }
  }

  // Players from both teams for Player of the Match selection (teamId also
  // drives the XI declaration picker sides).
  const matchPlayers = await db.select({ id: players.id, name: players.name, teamId: players.teamId }).from(players)
    .where(and(eq(players.tenantId, match.tenantId), inArray(players.teamId, [teamA.id, teamB.id])))

  // Active declared XIs (COMP-06 slice): names resolved from both sides'
  // rosters; a declared player is always a roster member of his side.
  const activeXiRows = await db.select({
    teamId: matchPlayingXis.teamId,
    playerId: matchPlayingXis.playerId,
    battingOrder: matchPlayingXis.battingOrder,
    wicketkeeper: matchPlayingXis.wicketkeeper,
  }).from(matchPlayingXis)
    .where(and(eq(matchPlayingXis.matchId, match.id), eq(matchPlayingXis.tenantId, match.tenantId),
      isNull(matchPlayingXis.supersededAt)))
    .orderBy(asc(matchPlayingXis.battingOrder))
  const playerNameById = new Map(matchPlayers.map(player => [player.id, player.name]))
  const teamAXi = activeXiRows
    .filter(row => row.teamId === teamA.id)
    .map(row => ({ playerId: row.playerId, battingOrder: row.battingOrder, wicketkeeper: row.wicketkeeper, name: playerNameById.get(row.playerId) ?? "Unknown Player" }))
  const teamBXi = activeXiRows
    .filter(row => row.teamId === teamB.id)
    .map(row => ({ playerId: row.playerId, battingOrder: row.battingOrder, wicketkeeper: row.wicketkeeper, name: playerNameById.get(row.playerId) ?? "Unknown Player" }))

  // Fetch Innings details
  const inningsRaw = await db.select().from(matchInnings)
    .where(and(eq(matchInnings.matchId, id), eq(matchInnings.tenantId, match.tenantId)))
    .orderBy(asc(matchInnings.inningsNumber))

  // Fetch scorecard details
  const scorecard = await getFullScorecard(id)

  // Map batting & bowling per innings
  const innings = await Promise.all(inningsRaw.map(async (inn) => {
    const battingEntries = scorecard.batting.filter(b => b.inningsId === inn.id)
    const bowlingEntries = scorecard.bowling.filter(b => b.inningsId === inn.id)

    // Resolve player names
    const battingWithNames = await Promise.all(battingEntries.map(async (b) => {
      const [p] = await db.select({ name: players.name }).from(players).where(and(eq(players.id, b.playerId), eq(players.tenantId, match.tenantId))).limit(1)
      
      // Also get bowler name and fielder name for dismissal text if needed
      let bowlerName = ""
      if (b.bowlerId) {
        const [bp] = await db.select({ name: players.name }).from(players).where(and(eq(players.id, b.bowlerId), eq(players.tenantId, match.tenantId))).limit(1)
        bowlerName = bp?.name ?? ""
      }
      let fielderName = ""
      if (b.fielderId) {
        const [fp] = await db.select({ name: players.name }).from(players).where(and(eq(players.id, b.fielderId), eq(players.tenantId, match.tenantId))).limit(1)
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
      const [p] = await db.select({ name: players.name }).from(players).where(and(eq(players.id, b.playerId), eq(players.tenantId, match.tenantId))).limit(1)
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

  // Missing rows preserve legacy unknowns; a known non-approved registration
  // blocks readiness just as it blocks a new canonical delivery (rule v2).
  let teamASquadDeclared: boolean | undefined
  let teamBSquadDeclared: boolean | undefined
  let teamARegistrationApproved: boolean | undefined
  let teamBRegistrationApproved: boolean | undefined
  if (match.tournamentId) {
    const squadRows = await db.select({
      tenantId: leagueRegistrations.tenantId,
      tournamentId: leagueRegistrations.tournamentId,
      teamId: leagueRegistrations.teamId,
      status: leagueRegistrations.status,
      squadPlayerIds: leagueRegistrations.squadPlayerIds,
    }).from(leagueRegistrations)
      .where(and(
        eq(leagueRegistrations.tenantId, match.tenantId),
        eq(leagueRegistrations.tournamentId, match.tournamentId),
        inArray(leagueRegistrations.teamId, [teamA.id, teamB.id]),
      )).orderBy(asc(leagueRegistrations.id)).limit(3)
    const registrations = matchRegistrationMap(squadRows, match.tenantId, match.tournamentId, [teamA.id, teamB.id])
    const a = registrations.get(teamA.id)
    const b = registrations.get(teamB.id)
    if (a) {
      teamASquadDeclared = Boolean(a.squadPlayerIds?.length)
      teamARegistrationApproved = a.status === "approved"
    }
    if (b) {
      teamBSquadDeclared = Boolean(b.squadPlayerIds?.length)
      teamBRegistrationApproved = b.status === "approved"
    }
  }

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
          {match.status === "scheduled" && <div className="flex items-center gap-2">
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
              operation="cancel"
              entityName={`${teamA.name} vs ${teamB.name}`}
            />
          </div>}
        </div>
      </MotionWrapper>

      {/* REG-05 (Batch 138): member-recorded availability */}
      <AvailabilityCard
        matchId={match.id}
        currentUserId={availabilityView.userId || null}
        initialStatus={availabilityView.status}
        answers={availabilityAnswers}
      />

      {/* FAN-04 (Batch 164): private no-stakes predictions - the view derives
          the verdict from the official row; the writer gates the window and
          membership. The read sizes the card only; the writer re-verifies. */}
      {predictionView && (
        <MatchPredictionCard
          matchId={match.id}
          teamAName={teamA.name}
          teamBName={teamB.name}
          view={{
            pick: predictionView.pick,
            windowOpen: predictionView.window.open,
            windowSentence: predictionView.window.sentence,
            settled: predictionView.settled,
            resultText: predictionView.resultText,
          }}
        />
      )}

      {/* REG-05 (Batch 141): scorecard correction requests - records,
          never mutations; the owner resolves, authority kept apart */}
      <CorrectionRequestCard
        matchId={match.id}
        viewerIsOwner={viewerLeagueOwner}
        myUserId={availabilityView.userId || null}
        myOpenRequest={myOpenRequest as CorrectionEntry | null}
        requests={correctionRequests as CorrectionEntry[]}
      />

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
          handoverEpoch={match.scorerHandoverEpoch}
          scoringRevision={match.scoringRevision}
          teamA={{ id: teamA.id, name: teamA.name }}
          teamB={{ id: teamB.id, name: teamB.name }}
          players={matchPlayers}
        />
        <div className="mt-3 space-y-3">
          <StreamStartModal matchId={match.id} currentStatus={match.streamStatus} broadcast={broadcastControl} />
          {viewerLeagueOwner && <BroadcastOverlayButton matchId={match.id} />}
          <ScorerAssign matchId={match.id} currentScorerId={match.scorerId} currentBackupScorerId={match.backupScorerId} />
          <UmpireAssign matchId={match.id} currentUmpire1Id={match.umpire1Id} currentUmpire2Id={match.umpire2Id} />
          {viewerOccupiesScorerSlot && (
            <div className="flex flex-wrap items-center gap-3">
              <ScorerApprovalButton matchId={match.id} />
              <p className="text-xs text-muted-foreground">The owner's assignment needs your consent before approval is recorded for you.</p>
            </div>
          )}
          {viewerOccupiesUmpireSlot && (
            <div className="flex flex-wrap items-center gap-3">
              <UmpireApprovalButton matchId={match.id} />
              <p className="text-xs text-muted-foreground">The owner's umpire assignment needs your consent before approval is recorded for you.</p>
            </div>
          )}
          <PlayingXiCard
            matchId={match.id}
            matchStatus={match.status}
            tournamentId={match.tournamentId}
            xiRequired={match.xiRequired}
            xiApprovedAt={match.xiApprovedAt}
            teamAId={teamA.id}
            teamBId={teamB.id}
            teamAName={teamA.name}
            teamBName={teamB.name}
            canDeclare={viewerCanDeclareXis}
            canApprove={viewerCanApproveXis}
            canSubstitute={viewerCanSubstituteXi}
            activeXi={{ teamA: teamAXi, teamB: teamBXi }}
            eligible={{
              teamA: matchPlayers.filter(player => player.teamId === teamA.id),
              teamB: matchPlayers.filter(player => player.teamId === teamB.id),
            }}
          />
        </div>
      </MotionWrapper>

      {/* Pre-match readiness checklist (COMP-06) */}
      <MotionWrapper variant="fadeInUp" delay={0.15}>
        <MatchReadinessCard
          match={{
            status: match.status,
            scheduledDate: match.scheduledDate,
            venueId: match.venueId,
            tossWinnerId: match.tossWinnerId,
            tossDecision: match.tossDecision,
            scorerId: match.scorerId,
            backupScorerId: match.backupScorerId,
            scorerApprovalRequired: match.scorerApprovalRequired,
            scorerApprovedAt: match.scorerApprovedAt,
            umpire1: match.umpire1,
            umpire1Id: match.umpire1Id,
            umpire2Id: match.umpire2Id,
            umpireApprovalRequired: match.umpireApprovalRequired,
            umpireApprovedAt: match.umpireApprovedAt,
            tournamentId: match.tournamentId,
            xiRequired: match.xiRequired,
            xiApprovedAt: match.xiApprovedAt,
            teamASquadDeclared,
            teamARegistrationApproved,
            teamBRegistrationApproved,
            teamBSquadDeclared,
          }}
        />
      </MotionWrapper>

      {/* FAN-01: owner-only fan reaction moderation (engagement-only surface) */}
      {viewerIsLeagueOwner && (
        <MotionWrapper variant="fadeInUp" delay={0.18}>
          <ReactionModerationCard matchId={id} initialReactions={moderatableReactions} initialReports={openReactionReports} initialBlocks={activeFanBlocks} />
        </MotionWrapper>
      )}

      {/* COMP-07 (Batch 153): owner-only competition controls - forfeit,
          postpone, reschedule. The writer is the gate; the card only sizes
          the buttons from the row it was rendered with. */}
      {viewerIsLeagueOwner && (
        <MotionWrapper variant="fadeInUp" delay={0.19}>
          <MatchControlCard matchId={id} matchStatus={match.status ?? null} />
        </MotionWrapper>
      )}

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
