"use server"

import { revalidatePath } from "next/cache"
import { declareTournamentAward } from "@/lib/award-records"

/**
 * PUB-04 official award declaration. All validation, the tournament:update
 * permission gate and the winner-eligibility rules live in the writer — the
 * caller may only hand through the declaration input. The public tournament
 * page is revalidated so a corrected award never leaves a stale gallery up.
 */
export async function declareAward(input: unknown) {
  const result = await declareTournamentAward(input)
  revalidatePath(`/tournaments/${result.tournamentId}`)
  return {
    success: true as const,
    changed: result.changed,
    awardId: result.awardId,
    supersededId: result.supersededId,
    tournamentId: result.tournamentId,
    category: result.category,
  }
}
