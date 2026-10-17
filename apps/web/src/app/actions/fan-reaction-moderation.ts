"use server"

import { removeFanReaction, readMatchReactionsForModeration } from "@/lib/fan-reaction-moderation"

/**
 * Thin delegates over the locked FAN-01 moderation writer. The owner gate,
 * tenant scoping, the FOR UPDATE lock and the audit all live in the writer;
 * this tier only validates and forwards.
 */

export async function getMatchReactionsForModeration(matchId: unknown) {
  return readMatchReactionsForModeration(matchId)
}

export async function removeModeratedReaction(input: unknown) {
  return removeFanReaction(input)
}
