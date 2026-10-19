import { scorerRunsToDelivery } from "@mtk/database/lib/scoring-delivery"
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
 */

export const recordBallCommandSchema = z.object({
  matchId: z.string().uuid(),
  inningsId: z.string().uuid(),
  clientOpId: z.string().trim().min(1).max(200),
  queueAccountId: z.string().min(1).max(200).optional(),
  queueTenantId: z.string().uuid().optional(),
  overNumber: z.number().int().min(0),
  ballNumber: z.number().int().min(1).max(6),
  runs: z.number().int().min(0).max(7),
  batsmanId: z.string().uuid().optional().nullable(),
  bowlerId: z.string().uuid().optional().nullable(),
  isWicket: z.boolean().default(false),
  wicketType: z.enum([
    "bowled", "caught", "lbw", "run_out", "stumped", "hit_wicket", "retired", "retired_hurt",
  ]).optional().nullable(),
  isWide: z.boolean().default(false),
  isNoBall: z.boolean().default(false),
  isBye: z.boolean().default(false),
  isLegBye: z.boolean().default(false),
  isFour: z.boolean().default(false),
  isSix: z.boolean().default(false),
  // SCORE-11 writer fencing: the handover epoch the scoring session observed.
  handoverEpoch: z.number().int().min(0).optional(),
  expectedRevision: z.number().int().min(0).max(2147483647).optional(),
  review: z.object({ reason: z.string().trim().min(10).max(1000),
    previousEpoch: z.number().int().min(0).optional(),
    previousRevision: z.number().int().min(0).optional(),
  }).optional(),
})

export type DeliverySubmission = z.infer<typeof recordBallCommandSchema>

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

  const wicket = validated.isWicket && validated.wicketType
    ? { type: validated.wicketType, playerId: validated.batsmanId }
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
