"use server"

import { removeFanReaction } from "@/lib/fan-reaction-moderation"

/**
 * Thin delegate over the locked FAN-01 moderation writer. The owner gate,
 * tenant scoping, the FOR UPDATE lock and the audit all live in the writer;
 * this tier only validates and forwards. (The moderation LIST is read
 * server-side through lib/fan-reaction-moderation directly - no action read.)
 */

export async function removeModeratedReaction(input: unknown) {
  return removeFanReaction(input)
}
