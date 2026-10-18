"use server"

import { revalidatePath } from "next/cache"
import { declareTournamentAward, revokeTournamentAward } from "@/lib/award-records"
import { raiseAwardDispute, resolveAwardDispute } from "@/lib/award-dispute-records"

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

/**
 * PUB-04 award disputes. Raising is member authority, resolving is owner
 * authority; both live entirely in the writer — the caller may only hand
 * through the input. Raising never mutates the award (revalidations just
 * refresh the galleries/queues that DISPLAY records).
 */
export async function raiseAwardDisputeAction(input: unknown) {
  const result = await raiseAwardDispute(input)
  revalidatePath("/tournaments")
  return {
    success: true as const,
    raised: result.raised,
    disputeId: result.disputeId,
  }
}

export async function resolveAwardDisputeAction(input: unknown) {
  const result = await resolveAwardDispute(input)
  revalidatePath("/tournaments")
  return {
    success: true as const,
    decided: result.decided,
    disputeId: result.disputeId,
    decision: result.decision,
  }
}

/**
 * PUB-04 revocation. Organizer authority; the writer re-checks everything.
 * The gallery revalidates so a revoked award never stays public.
 */
export async function revokeAwardAction(input: unknown) {
  const result = await revokeTournamentAward(input)
  revalidatePath(`/tournaments/${result.tournamentId}`)
  return {
    success: true as const,
    revoked: result.revoked,
    awardId: result.awardId,
    category: result.category,
  }
}
