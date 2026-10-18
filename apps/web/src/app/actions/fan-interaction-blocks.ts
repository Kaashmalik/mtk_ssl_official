"use server"

import {
  blockFanInteraction,
  liftFanBlock,
} from "@/lib/fan-block-records"

/**
 * Thin delegates over the locked FAN-01 anti-abuse writer. The owner gate,
 * the league-scope pinning, the partial-unique replay safety, the FOR UPDATE
 * lift lock and the audits all live in the writer; this tier only validates
 * and forwards. (Active blocks are read server-side through
 * lib/fan-block-records directly - no action read.)
 */

export async function blockFanInteractionAction(input: unknown) {
  return blockFanInteraction(input)
}

export async function liftFanBlockAction(input: unknown) {
  return liftFanBlock(input)
}
