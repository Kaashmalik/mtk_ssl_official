import type { getMatchForScoring } from "@/app/actions/scoring"
import type { BallInput, InningsState, ScoringState } from "@/stores/scoring-store"
import { hasUnconfirmedDeliveries } from "./reconcile-live-state"

export type ScoringPageSnapshot = Awaited<ReturnType<typeof getMatchForScoring>>

/** Hydrate reloads without dropping offline balls or a newer socket snapshot. */
export function hydrateScoringState(state: ScoringState, snapshot: ScoringPageSnapshot): Partial<ScoringState> {
  if (state.matchId !== snapshot.match.id || hasUnconfirmedDeliveries(state)) return {}
  const build = (number: number, local: InningsState | null): InningsState | null => {
    const innings = snapshot.innings.find((value) => value.inningsNumber === number)
    if (!innings) {
      if (local?.lastSnapshotAt) return local
      if (number !== 1) return null
      const { match } = snapshot
      const battingFirst = match.tossWinnerId && match.tossDecision === "bat" ? match.tossWinnerId
        : match.tossWinnerId && match.tossDecision === "bowl"
          ? match.tossWinnerId === match.teamAId ? match.teamBId : match.teamAId : match.teamAId
      return { inningsId: `pending-innings-1-${match.id}`, teamId: battingFirst,
        totalRuns: 0, totalWickets: 0, totalBalls: 0, extras: 0, wides: 0, noBalls: 0,
        byes: 0, legByes: 0, status: "not_started", currentOver: 0, currentBall: 0, balls: [] }
    }
    const newer = local?.lastSnapshotAt && Date.parse(local.lastSnapshotAt) > innings.updatedAt.getTime()
    const balls = snapshot.recentBalls.filter((ball) => ball.inningsId === innings.id)
      .sort((a, b) => a.ballSequence - b.ballSequence)
      .map((ball) => ({
        id: ball.id, clientOpId: ball.clientOpId ?? undefined,
        overNumber: ball.overNumber, ballNumber: ball.ballNumber,
        input: (ball.isWicket ? "W" : ball.isWide ? "WD" : ball.isNoBall ? "NB" :
          ball.isBye ? "B" : ball.isLegBye ? "LB" : ball.runs) as BallInput,
        runs: ball.runs, isWicket: ball.isWicket, isWide: ball.isWide, isNoBall: ball.isNoBall,
        isBye: ball.isBye, isLegBye: ball.isLegBye, isFour: ball.isFour, isSix: ball.isSix,
        batsmanId: ball.batsmanId ?? undefined, bowlerId: ball.bowlerId ?? undefined,
        timestamp: ball.createdAt.getTime(),
      }))
    if (newer) return local
    return { inningsId: innings.id, teamId: innings.teamId,
      totalRuns: innings.totalRuns, totalWickets: innings.totalWickets, totalBalls: innings.totalBalls,
      extras: innings.extras, wides: innings.wides, noBalls: innings.noBalls,
      byes: innings.byes, legByes: innings.legByes, status: innings.status,
      currentOver: Math.floor(innings.totalBalls / 6),
      currentBall: innings.totalBalls % 6, balls, lastSnapshotAt: innings.updatedAt.toISOString() }
  }
  const innings1 = build(1, state.innings1)
  const innings2 = build(2, state.innings2)
  const superOver = build(3, state.superOver)
  const emptyHistory = () => ({ history: [], historyIndex: -1 })
  const matchIsNewer = !state.matchUpdatedAt || snapshot.match.updatedAt.getTime() >= Date.parse(state.matchUpdatedAt)
  return { innings1, innings2, superOver,
    ...(matchIsNewer ? { matchStatus: snapshot.match.status, matchUpdatedAt: snapshot.match.updatedAt.toISOString() } : {}),
    currentInnings: superOver ? "super_over" : innings2 ? 2 : 1,
    innings1History: emptyHistory(), innings2History: emptyHistory(), superOverHistory: emptyHistory() }
}
