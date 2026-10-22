import { scorerRunsToDelivery } from "@mtk/database/lib/scoring-delivery"
import { recordBallCommandSchema } from "@mtk/contracts"
import type { ScoringAcknowledgement, ScoringParticipants } from "@mtk/contracts"
import { requireMatchScoringAccess, requireScoringActorId } from "@/lib/scoring-access"
import { readInningsForCommand } from "@/lib/scoring-reads"
import { proxyRecordBall } from "@/lib/scoring-service-client"
import { z } from "zod"

/**
 * The single authenticated delivery-submission path. Both the recordBall
 * server action (desktop/web session) and the mobile intake API route
 * (Clerk Bearer token) delegate here, so mobile submissions carry the SAME
 * tenant resolution, match access gate, actor resolution, innings boundary,
 * SoT proxying and operation-id echo pin as every other canonical write.
 * Transport never changes authority.
 *
 * ENH-03-01: the command schema is MOVED to `@mtk/contracts` so the web
 * action, the mobile intake route and the offline queue flush validate
 * against ONE versioned schema. This module re-exports it for existing
 * importers.
 */

export { recordBallCommandSchema }

export type DeliverySubmission = z.infer<typeof recordBallCommandSchema>

/**
 * Web acknowledgement: the contract envelope with the scorecard narrowed to
 * the canonical service shape. Structural assignability is pinned so the
 * web type and the contract envelope cannot drift apart silently.
 */
export type DeliveryAcknowledgement = {
  success: true
  ballId: string
  scoringRevision: number
  clientOpId: string | null
  replayed?: boolean
  scorecard: Awaited<ReturnType<typeof proxyRecordBall>>["scorecard"]
  /** Batch 100: service-confirmed participant projection (flag-gated). */
  participants?: ScoringParticipants | null
}

// Contract-parity: a richly typed web acknowledgement IS a contract
// ScoringAcknowledgement (scorecard narrows to `unknown` one-way).
const _deliveryAcknowledgementIsContractAck: ScoringAcknowledgement = {} as DeliveryAcknowledgement
void _deliveryAcknowledgementIsContractAck

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

  // Batch 100: the flat command now carries the scorer's actual wicket
  // attribution. Previously this mapping silently rewrote it to
  // `playerId: batsmanId` - correct for striker-out dismissals, wrong for
  // every off-strike run-out/retirement, and it made canonical crease state
  // underivable. The striker fallback keeps older clients (which predate the
  // attribution fields) working; the canonical service still validates the
  // named player against the batting XI either way.
  const wicket = validated.isWicket && validated.wicketType
    ? {
      type: validated.wicketType,
      playerId: validated.wicketPlayerOutId ?? validated.batsmanId,
      ...(validated.wicketFielderId ? { fielderId: validated.wicketFielderId } : {}),
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
    participants: result.participants ?? null,
  }
}
