import type { QueuedBall } from "./offline-ball-queue"
import type { ScoringPageSnapshot } from "./scoring-hydration"
import type { RecordBallInput } from "@/app/actions/scoring"
import type { ScoringState } from "@/stores/scoring-store"

/** Predicted ordered revision for the most recently added local delivery. */
export function pendingDeliveryRevision(state: ScoringState): number {
  const unconfirmed = [state.innings1, state.innings2, state.superOver].reduce((count, innings) =>
    count + (innings?.balls.filter(ball => ball.id.startsWith("ball-")).length ?? 0), 0)
  return (state.scoringRevision ?? 0) + Math.max(0, unconfirmed - 1)
}

/** Explicit review only: preserve identity/content/coordinates, never force a score. */
export function reviewedDelivery(item: QueuedBall, snapshot: ScoringPageSnapshot, reason: string): RecordBallInput {
  if (!snapshot.canScore || item.matchId !== snapshot.match.id || item.payload.matchId !== item.matchId ||
      item.payload.inningsId !== item.inningsId || !snapshot.innings.some(innings => innings.id === item.inningsId)) {
    throw new Error("This saved delivery cannot be reviewed in the current authorized match.")
  }
  const reviewReason = reason.trim()
  if (reviewReason.length < 10 || reviewReason.length > 1000) throw new Error("Explain the review in 10 to 1000 characters.")
  return { ...item.payload, clientOpId: item.clientOpId,
    handoverEpoch: snapshot.match.handoverEpoch, expectedRevision: snapshot.match.scoringRevision,
    review: { reason: reviewReason,
      previousEpoch: typeof item.payload.handoverEpoch === "number" ? item.payload.handoverEpoch : undefined,
      previousRevision: typeof item.payload.expectedRevision === "number" ? item.payload.expectedRevision : undefined,
    },
  } as RecordBallInput
}
