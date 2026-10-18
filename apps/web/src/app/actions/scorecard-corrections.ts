"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { CORRECTION_REASONS } from "@mtk/database/lib/scorecard-correction-policy"
import { resolveScorecardCorrection, submitScorecardCorrection } from "@/lib/scorecard-corrections"

const submitSchema = z.object({
  matchId: z.string().uuid(),
  reason: z.enum(CORRECTION_REASONS),
})

const resolveSchema = z.object({
  requestId: z.string().uuid(),
  decision: z.enum(["approved", "dismissed"]),
})

/**
 * REG-05 (Batch 141): the member side - raise a scorecard correction
 * request. The actor is exclusively the session; the schema refuses
 * malformed intents before any transaction.
 */
export async function raiseScorecardCorrection(input: unknown) {
  const validated = submitSchema.parse(input)
  const result = await submitScorecardCorrection(validated.matchId, validated.reason)
  revalidatePath("/dashboard/matches")
  return { success: true as const, requestId: result.requestId, changed: result.changed }
}

/**
 * The owner side - resolve an open request (approved | dismissed). The
 * writer re-verifies league-owner authority under a lock.
 */
export async function resolveScorecardCorrectionRequest(input: unknown) {
  const validated = resolveSchema.parse(input)
  const result = await resolveScorecardCorrection(validated.requestId, validated.decision)
  revalidatePath("/dashboard/matches")
  return { success: true as const, status: result.status }
}
