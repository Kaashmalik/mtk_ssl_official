import { scorerRunsToDelivery } from "@mtk/database/lib/scoring-delivery"
import { requireMatchScoringAccess, requireScoringActorId } from "@/lib/scoring-access"
import { readInningsForCommand } from "@/lib/scoring-reads"
import { proxyRecordBall } from "@/lib/scoring-service-client"
import { recordBallCommandSchema, type RecordBallCommandV1 } from "@mtk/contracts"

/**
 * The single authenticated delivery-submission path. Both the recordBall
 * server action (desktop/web session) and the mobile intake API route
 * (Clerk Bearer token) delegate here, so mobile submissions carry the SAME
 * tenant resolution, match access gate, actor resolution, innings boundary,
 * SoT proxying and operation-id echo pin as every other canonical write.
 * Transport never changes authority.
 *
 * ENH-03-02: the command schema is the SHARED @mtk/contracts vocabulary —
 * one validated boundary for web sessions and the mobile intake, including
 * explicit wicket attribution (wicketPlayerId/fielderId). Nothing that the
 * schema accepts is silently stripped on the way to the service.
 */

export { recordBallCommandSchema }

export type DeliverySubmission = RecordBallCommandV1

export type DeliveryAcknowledgement = {
  success: true
  ballId: string
  scoringRevision: number
  clientOpId: string | null
  replayed?: boolean
  scorecard: Awaited<ReturnType<typeof proxyRecordBall>>["scorecard"]
}

export async function submitDelivery(accountId: string, tenantId: string, validated: DeliverySubmission): Promise<DeliveryAcknowledgement> {
  if (!validated.batsmanId || !validated.bowlerId) {
    throw new Error("Batsman and bowler are required")
  }

  await requireMatchScoringAccess(accountId, tenantId, validated.matchId)
  const actorId = await requireScoringActorId(accountId)
  const innings = await readInningsForCommand(validated.inningsId, validated.matchId, tenantId)
  if (!innings) throw new Error("Innings not found")
  // Lifecycle and replay decisions belong to the canonical service: a retry
  // may legitimately acknowledge a delivery accepted before completion.

  const delivery = scorerRunsToDelivery(validated)
  if (validated.isWicket && !validated.wicketType) throw new Error("Select a dismissal type")

  // Wicket attribution: the named-out player defaults to the batsman on
  // strike (a run out may explicitly name the non-striker), and the fielder
  // who completed the dismissal rides with it. The canonical service
  // enforces the on-field rules; this path only guarantees nothing is lost.
  const wicket = validated.isWicket && validated.wicketType
    ? {
        type: validated.wicketType,
        playerId: validated.wicketPlayerId ?? validated.batsmanId,
        ...(validated.fielderId ? { fielderId: validated.fielderId } : {}),
      }
    : undefined

  const result = await proxyRecordBall({
    matchId: validated.matchId,
    inningsId: validated.inningsId,
    clientOpId: validated.clientOpId,
    over: validated.overNumber,
    ball: validated.ballNumber,
    runs: delivery.runs,
    batsmanId: validated.batsmanId,
    bowlerId: validated.bowlerId,
    extras: delivery.extras,
    wicket,
    handoverEpoch: validated.handoverEpoch,
    expectedRevision: validated.expectedRevision,
    review: validated.review,
  }, tenantId, actorId)

  if (validated.clientOpId && result.clientOpId !== validated.clientOpId) {
    throw new Error("Scoring service did not acknowledge this operation ID")
  }

  return {
    success: true,
    ballId: result.ballId,
    scoringRevision: result.scoringRevision,
    clientOpId: validated.clientOpId ?? null,
    replayed: result.replayed ?? false,
    scorecard: result.scorecard,
  }
}
