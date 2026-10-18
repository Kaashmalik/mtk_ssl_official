"use server"

import {
  blockFanInteraction,
  liftFanBlock,
  readActiveFanBlocks,
} from "@/lib/fan-block-records"

/**
 * Thin delegates over the locked FAN-01 anti-abuse writer. The owner gate,
 * the league-scope pinning, the partial-unique replay safety, the FOR UPDATE
 * lift lock and the audits all live in the writer; this tier only validates
 * and forwards.
 */

export async function blockFanInteractionAction(input: unknown) {
  return blockFanInteraction(input)
}

export async function liftFanBlockAction(input: unknown) {
  return liftFanBlock(input)
}

export async function getActiveFanBlocks() {
  return readActiveFanBlocks()
}
