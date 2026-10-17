"use server"

import { z } from "zod"
import { toggleFanReaction } from "@/lib/fan-reactions"

/**
 * Thin delegate over the locked FAN-01 reaction toggle. Identity, league
 * scope, publication/target policy, the flood floor and the toggle (with
 * fresh counts in the reply) all live in the writer - this tier only parses.
 *
 * Scope safety is structural: the fan's SESSION resolves the league the write
 * happens in, so a match id from another league simply reads as an
 * unpublished target there and is refused - the public host's tenant can
 * never widen what a signed-in fan may react to.
 */

const matchInput = z.object({ matchId: z.string().uuid() }).strict()

export async function toggleMatchReaction(matchIdInput: unknown, reactionInput: unknown) {
  const { matchId } = matchInput.parse(matchIdInput)
  const reaction = z.string().min(1).max(16).parse(reactionInput)
  return toggleFanReaction({ matchId, reaction })
}
