import { decodeLiveMatchState, type LiveInnings } from "@mtk/database/lib/live-scoring-state"
import type { InningsState, ScoringState } from "@/stores/scoring-store"

export function hasUnconfirmedDeliveries(state: ScoringState) {
  return [state.innings1, state.innings2, state.superOver].some((innings) =>
    innings?.balls.some((ball) => ball.id.startsWith("ball-")))
}

function reconcileInnings(local: InningsState | null, remote: LiveInnings): InningsState {
  if (local?.lastSnapshotAt && Date.parse(local.lastSnapshotAt) > Date.parse(remote.updatedAt)) return local
  return {
    inningsId: remote.inningsId, teamId: remote.teamId,
    totalRuns: remote.totalRuns, totalWickets: remote.totalWickets, totalBalls: remote.totalBalls,
    extras: remote.extras, wides: remote.wides, noBalls: remote.noBalls,
    byes: remote.byes, legByes: remote.legByes, status: remote.status,
    currentOver: remote.overs, currentBall: remote.balls,
    balls: local?.inningsId === remote.inningsId ? local.balls : [],
    lastSnapshotAt: remote.updatedAt,
  }
}

/** Never apply another match, a malformed snapshot, or overwrite pending scoring. */
export function reconcileLiveState(state: ScoringState, input: unknown): Partial<ScoringState> {
  const remote = decodeLiveMatchState(input)
  if (!remote || state.matchId !== remote.matchId || hasUnconfirmedDeliveries(state)) return {}
  const next: Partial<ScoringState> = {}
  if (!state.matchUpdatedAt || Date.parse(remote.updatedAt) >= Date.parse(state.matchUpdatedAt)) {
    next.matchStatus = remote.status
    next.matchUpdatedAt = remote.updatedAt
    next.currentInnings = remote.currentInnings === 3 ? "super_over" : remote.currentInnings as 1 | 2
  }
  for (const key of ["innings1", "innings2", "superOver"] as const) {
    if (remote[key]) next[key] = reconcileInnings(state[key], remote[key])
  }
  return next
}
