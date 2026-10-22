/**
 * ENH-09-01: portable OBS overlay projection.
 *
 * The overlay is a read-only presentation of canonical score data. It does not
 * compute official results, invent wickets or claim a batter is on strike when
 * the scoring service has not confirmed participant state. Figures below are
 * aggregates of recorded deliveries, labelled as such by the renderer.
 *
 * Batch 100: the reader MAY attach `participants` - the canonical
 * striker/non-striker/bowler projection folded server-side from the official
 * delivery log behind SCORING_PARTICIPANTS_READY. When attached, the
 * projection carries service-confirmed names/figures under `participants`
 * and the legacy `lastBatter`/`lastBowler` aggregates stay side by side.
 * When absent (flag off, or the fold could not run), participants is null
 * and the renderer keeps aggregate-only presentation.
 */

import type { ScoringParticipants } from "./scoring"

export type BroadcastOverlayTeamInput = {
  id: string
  name: string
  logoUrl: string | null
}

export type BroadcastOverlayInningsInput = {
  inningsNumber: number
  teamId: string
  totalRuns: number
  totalWickets: number
  totalBalls: number
}

export type BroadcastOverlayBallInput = {
  /** Stable canonical delivery id; event dedup must never key on a position. */
  id: string
  inningsNumber: number
  runs: number
  isWicket: boolean
  isWide: boolean
  isNoBall: boolean
  isBye: boolean
  isLegBye: boolean
  isFour: boolean
  isSix: boolean
  batsmanId: string | null
  bowlerId: string | null
  wicketType: string | null
  /** Batch 100: scorer-named victim (optional in the log input; the fold's
   *  self-healing rules cover deliveries recorded before the attribution
   *  columns existed). */
  wicketPlayerOutId?: string | null
}

/** Service-confirmed active participants, parked on the current innings.
 *  Every id here came from the official delivery log folded server-side by
 *  `@mtk/database/lib/scoring-participants` - never client inference. */
export type BroadcastOverlayParticipants = {
  confirmed: boolean
  lastBallSequence: number | null
  striker: { id: string; name: string; runs: number; balls: number } | null
  nonStriker: { id: string; name: string; runs: number; balls: number } | null
  bowler: { id: string; name: string; balls: number; runs: number; wickets: number } | null
  /** Bowler of the over that just completed (the fold's boundary anchor) -
   *  lets consumers confirm a bowler change during the between-overs gap
   *  where the next bowler is deliberately still unknown. */
  previousBowlerId: string | null
  incomingBatter: { id: string; name: string } | null
  /** Every confirmed crease occupant, WITHOUT a strike-end claim. After a
   *  dismissal (before the next recorded delivery names the new striker)
   *  the striker/non-striker fields are null while this list still names
   *  the survivor - the honest intermediate state. */
  crease: Array<{ id: string; name: string; runs: number; balls: number }>
}

export type BroadcastOverlayPlayer = { id: string; name: string }

export type BroadcastOverlaySnapshot = {
  matchId: string
  tenantId: string
  status: string
  /** Canonical scoring revision; celebration events are deduped/fenced on it. */
  scoringRevision: number
  updatedAt: string
  league: {
    name: string
    logoUrl: string | null
    primaryColor: string
    secondaryColor: string
  }
  teams: {
    teamA: { id: string; name: string; logoUrl: string | null; runs: number; wickets: number; overs: string }
    teamB: { id: string; name: string; logoUrl: string | null; runs: number; wickets: number; overs: string }
  }
  current: {
    inningsNumber: number
    battingTeamId: string
    runs: number
    wickets: number
    overs: string
    runRate: string
    target: number | null
    requiredRate: string | null
    recentBalls: Array<{
      id: string
      key: string
      label: string
      tone: "run" | "boundary" | "wicket" | "extra"
      wicketType: string | null
      bowlerCreditedWicket: boolean
    }>
    lastBatter: { id: string; name: string; runs: number; balls: number } | null
    lastBowler: { id: string; name: string; balls: number; runs: number; wickets: number } | null
    /** Service-confirmed striker/non-striker/bowler (Batch 100). Absent or
     *  `null` unless the server folded the official delivery log with
     *  SCORING_PARTICIPANTS_READY on AND the fold stayed consistent
     *  (introductions are claimed only from a confirmed block). Optional so
     *  pre-Batch-100 snapshots stay assignable without a rebuild. */
    participants?: BroadcastOverlayParticipants | null
  } | null
}

export function formatOverlayOvers(totalBalls: number): string {
  const safe = Number.isSafeInteger(totalBalls) && totalBalls > 0 ? totalBalls : 0
  return `${Math.floor(safe / 6)}.${safe % 6}`
}

export function broadcastBallLabel(ball: BroadcastOverlayBallInput): {
  label: string
  tone: "run" | "boundary" | "wicket" | "extra"
} {
  if (ball.isWicket) return { label: "W", tone: "wicket" }
  if (ball.isWide) return { label: "WD", tone: "extra" }
  if (ball.isNoBall) return { label: "NB", tone: "extra" }
  if (ball.isBye) return { label: `B${ball.runs}`, tone: "extra" }
  if (ball.isLegBye) return { label: `LB${ball.runs}`, tone: "extra" }
  if (ball.isSix) return { label: "6", tone: "boundary" }
  if (ball.isFour) return { label: "4", tone: "boundary" }
  if (ball.runs === 0) return { label: "•", tone: "run" }
  return { label: String(ball.runs), tone: "run" }
}

/** Batter runs exclude byes/leg-byes and the wide penalty. */
export function overlayBatterRuns(ball: BroadcastOverlayBallInput): number {
  if (ball.isBye || ball.isLegBye || ball.isWide) return 0
  return ball.isNoBall ? Math.max(0, ball.runs - 1) : ball.runs
}

/** Bowler concessions exclude byes/leg-byes; wides/no-balls count. */
export function overlayBowlerRuns(ball: BroadcastOverlayBallInput): number {
  return ball.isBye || ball.isLegBye ? 0 : ball.runs
}

export function overlayLegalBall(ball: BroadcastOverlayBallInput): boolean {
  return !ball.isWide && !ball.isNoBall
}

export function overlayBowlerWicket(ball: BroadcastOverlayBallInput): boolean {
  if (!ball.isWicket) return false
  return !["run_out", "retired", "retired_hurt"].includes(ball.wicketType ?? "")
}

export function buildBroadcastOverlaySnapshot(input: {
  match: {
    id: string
    tenantId: string
    status: string
    scoringRevision: number
    updatedAt: string
    totalOvers: number
    teamAId: string
    teamBId: string
  }
  teams: BroadcastOverlayTeamInput[]
  innings: BroadcastOverlayInningsInput[]
  balls: BroadcastOverlayBallInput[]
  players: BroadcastOverlayPlayer[]
  branding: {
    name: string
    logoUrl: string | null
    primaryColor: string | null
    secondaryColor: string | null
  } | null
  /** Batch 100: the canonical participant projection folded server-side
   *  from the same delivery log over `balls`. Absent/null keeps the
   *  aggregate-only snapshot shape (flag off, fold unavailable). */
  participants?: ScoringParticipants | null
}): BroadcastOverlaySnapshot {
  const teamById = new Map(input.teams.map(team => [team.id, team]))
  const playerById = new Map(input.players.map(player => [player.id, player]))
  const inningsByTeam = new Map(input.innings.map(row => [row.teamId, row]))
  const latest = [...input.innings].sort((a, b) => a.inningsNumber - b.inningsNumber).at(-1) ?? null
  const currentTeam = latest ? teamById.get(latest.teamId) : undefined
  const currentBalls = latest
    ? input.balls.filter(ball => ball.inningsNumber === latest.inningsNumber)
    : []

  const teamProjection = (teamId: string) => {
    const team = teamById.get(teamId)
    const innings = inningsByTeam.get(teamId)
    return {
      id: teamId,
      name: team?.name ?? "TBD",
      logoUrl: team?.logoUrl ?? null,
      runs: innings?.totalRuns ?? 0,
      wickets: innings?.totalWickets ?? 0,
      overs: formatOverlayOvers(innings?.totalBalls ?? 0),
    }
  }

  const current = latest && currentTeam ? (() => {
    const first = input.innings.find(row => row.inningsNumber === 1)
    const previous = input.innings.find(row => row.inningsNumber === latest.inningsNumber - 1)
    const target = latest.inningsNumber >= 2 && previous
      ? (latest.inningsNumber === 2 && first ? first.totalRuns : previous.totalRuns) + 1
      : null
    const remainingBalls = Math.max(0, input.match.totalOvers * 6 - latest.totalBalls)
    const requiredRate = target !== null && remainingBalls > 0
      ? ((target - latest.totalRuns) / remainingBalls * 6).toFixed(2)
      : null

    const recentBalls = currentBalls.slice(-6).map(ball => ({
      id: ball.id,
      key: ball.id,
      ...broadcastBallLabel(ball),
      wicketType: ball.wicketType,
      bowlerCreditedWicket: overlayBowlerWicket(ball),
    }))

    const lastBatterBall = [...currentBalls].reverse().find(ball => ball.batsmanId)
    const batterId = lastBatterBall?.batsmanId ?? null
    const batterBalls = batterId ? currentBalls.filter(ball => ball.batsmanId === batterId) : []
    const lastBowlerBall = [...currentBalls].reverse().find(ball => ball.bowlerId)
    const bowlerId = lastBowlerBall?.bowlerId ?? null
    const bowlerBalls = bowlerId ? currentBalls.filter(ball => ball.bowlerId === bowlerId) : []

    return {
      inningsNumber: latest.inningsNumber,
      battingTeamId: latest.teamId,
      runs: latest.totalRuns,
      wickets: latest.totalWickets,
      overs: formatOverlayOvers(latest.totalBalls),
      runRate: latest.totalBalls > 0 ? (latest.totalRuns / (latest.totalBalls / 6)).toFixed(2) : "0.00",
      target,
      requiredRate,
      recentBalls,
      lastBatter: batterId ? {
        id: batterId,
        name: playerById.get(batterId)?.name ?? "Batter",
        runs: batterBalls.reduce((sum, ball) => sum + overlayBatterRuns(ball), 0),
        balls: batterBalls.filter(ball => !ball.isWide).length,
      } : null,
      lastBowler: bowlerId ? {
        id: bowlerId,
        name: playerById.get(bowlerId)?.name ?? "Bowler",
        balls: bowlerBalls.filter(overlayLegalBall).length,
        runs: bowlerBalls.reduce((sum, ball) => sum + overlayBowlerRuns(ball), 0),
        wickets: bowlerBalls.filter(overlayBowlerWicket).length,
      } : null,
      participants: buildParticipantsProjection(input.participants ?? null, currentBalls, playerById),
    }
  })() : null

  return {
    matchId: input.match.id,
    tenantId: input.match.tenantId,
    status: input.match.status,
    scoringRevision: input.match.scoringRevision,
    updatedAt: input.match.updatedAt,
    league: {
      name: input.branding?.name?.trim() || "Cricket",
      logoUrl: input.branding?.logoUrl ?? null,
      primaryColor: input.branding?.primaryColor || "#16a34a",
      secondaryColor: input.branding?.secondaryColor || "#0f172a",
    },
    teams: {
      teamA: teamProjection(input.match.teamAId),
      teamB: teamProjection(input.match.teamBId),
    },
    current,
  }
}

/**
 * Batch 100: project the canonical participant fold onto the snapshot with
 * resolved names and the SAME aggregate figure rules as the batter/bowler
 * blocks. Figures stay aggregates of recorded deliveries; only the
 * identity ("this batter is on strike") is the service-confirmed part.
 */
export function buildParticipantsProjection(
  participants: ScoringParticipants | null,
  currentBalls: BroadcastOverlayBallInput[],
  playerById: Map<string, BroadcastOverlayPlayer>,
): BroadcastOverlayParticipants | null {
  if (!participants) return null
  const nameOf = (id: string | null, fallback: string): string | null => {
    if (id == null) return null
    return playerById.get(id)?.name ?? fallback
  }
  const batterFigure = (id: string | null) => {
    if (id == null) return null
    const faced = currentBalls.filter(ball => ball.batsmanId === id)
    const name = nameOf(id, "Batter")!
    return {
      id,
      name,
      runs: faced.reduce((sum, ball) => sum + overlayBatterRuns(ball), 0),
      balls: faced.filter(ball => !ball.isWide).length,
    }
  }
  const striker = batterFigure(participants.strikerId)
  const nonStriker = participants.nonStrikerId != null && participants.nonStrikerId !== participants.strikerId
    ? batterFigure(participants.nonStrikerId)
    : null
  const bowler = (() => {
    if (participants.bowlerId == null) return null
    const bowled = currentBalls.filter(ball => ball.bowlerId === participants.bowlerId)
    const name = nameOf(participants.bowlerId, "Bowler")!
    return {
      id: participants.bowlerId,
      name,
      balls: bowled.filter(overlayLegalBall).length,
      runs: bowled.reduce((sum, ball) => sum + overlayBowlerRuns(ball), 0),
      wickets: bowled.filter(overlayBowlerWicket).length,
    }
  })()
  const incomingBatter = (() => {
    if (participants.incomingBatterId == null) return null
    return { id: participants.incomingBatterId, name: nameOf(participants.incomingBatterId, "Batter")! }
  })()
  return {
    confirmed: participants.confirmed,
    lastBallSequence: participants.lastBallSequence,
    striker,
    nonStriker,
    bowler,
    previousBowlerId: participants.previousOverBowlerId,
    incomingBatter,
    crease: participants.creaseBatterIds
      .map(id => batterFigure(id) ?? { id, name: nameOf(id, "Batter")!, runs: 0, balls: 0 }),
  }
}
