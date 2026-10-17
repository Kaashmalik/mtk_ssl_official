"use server"

import { revalidatePath } from "next/cache"
import { approveTournamentPrize, recordPrizePayout, saveTournamentPrize } from "@/lib/prize-records"

/**
 * PUB-05 prize management. All validation, the tournament:update permission
 * gate, the lifecycle rules and the payout-truthfulness rules live in the
 * writer — the caller may only hand through the input. The public tournament
 * page is revalidated so an approved prize or recorded payout never leaves a
 * stale public surface up.
 */
export async function savePrize(input: unknown) {
  const result = await saveTournamentPrize(input)
  revalidatePath(`/tournaments/${result.tournamentId}`)
  return {
    success: true as const,
    changed: result.changed,
    prizeId: result.prizeId,
    tournamentId: result.tournamentId,
  }
}

export async function approvePrize(input: unknown) {
  const result = await approveTournamentPrize(input)
  revalidatePath(`/tournaments/${result.tournamentId}`)
  return {
    success: true as const,
    changed: result.changed,
    prizeId: result.prizeId,
    tournamentId: result.tournamentId,
  }
}

export async function recordPayout(input: unknown) {
  const result = await recordPrizePayout(input)
  revalidatePath(`/tournaments/${result.tournamentId}`)
  return {
    success: true as const,
    changed: result.changed,
    prizeId: result.prizeId,
    tournamentId: result.tournamentId,
  }
}
