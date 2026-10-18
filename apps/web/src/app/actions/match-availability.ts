"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { AVAILABILITY_STATUSES } from "@mtk/database/lib/match-availability-policy"
import { setMyAvailability } from "@/lib/match-availability"

const availabilityInputSchema = z.object({
  matchId: z.string().uuid(),
  status: z.enum(AVAILABILITY_STATUSES),
})

/**
 * REG-05 (Batch 138): a member records their own availability for a match.
 * The actor is exclusively the session - a caller can only ever answer for
 * THEMSELF; there is no actor-override parameter to misuse. Errors surface
 * verbatim (they are written as member-facing sentences in the writer).
 */
export async function setMatchAvailability(input: unknown) {
  const validated = availabilityInputSchema.parse(input)
  const result = await setMyAvailability(validated.matchId, validated.status)
  revalidatePath("/dashboard/matches")
  return { success: true as const, status: result.status, changed: result.changed }
}
