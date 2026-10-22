/**
 * ENH-09-01: portable OBS overlay projection.
 *
 * The overlay is a read-only presentation of canonical score data. It does not
 * compute official results, invent wickets or claim a batter is on strike when
 * the scoring service has not confirmed participant state. Figures below are
 * aggregates of recorded deliveries, labelled as such by the renderer.
 */

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
