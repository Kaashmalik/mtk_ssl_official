"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { saveMyPrediction } from "@/lib/fan-predictions"

/**
 * FAN-04 (Batch 164): thin action wrapper over the prediction writer. The
 * writer holds every gate (session, active membership, prediction window);
 * this bound just keeps malformed input away from the transaction. Views
 * are provisioned server-side by the page (no prediction read action).
 */

const pickSchema = z.enum(["home", "away"])

export async function saveMyPredictionAction(input: { matchId: string; pick: string }) {
  const parsed = z
    .object({ matchId: z.string().uuid(), pick: pickSchema })
    .strict()
    .parse(input)
  const result = await saveMyPrediction(parsed.matchId, parsed.pick)
  revalidatePath(`/dashboard/matches/${parsed.matchId}`)
  return result
}

