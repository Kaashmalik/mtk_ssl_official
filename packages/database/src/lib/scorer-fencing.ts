/**
 * SCORE-11 writer fencing (shared, pure): a handover epoch on the match row
 * fences stale scoring devices. The canonical scoring boundary compares the
 * command's echoed epoch against the locked match row's current epoch.
 *
 * Rules (fail closed):
 * - The match epoch is the column value; an unread column (undefined/network
 *   legacy) or a missing column (pre-migration deployment) reads as 0 — the
 *   fencing only ever REOPENS accidentally toward "no handover yet", which is
 *   the legacy behavior, never toward "device is fresh".
 * - A command with NO token is accepted only while no handover has ever
 *   occurred (epoch 0). After the first handover every authoritative write
 *   must present the epoch its scoring session last observed. This is what
 *   makes a stale device of a re-occupied scorer fail closed: the slot
 *   pointer alone cannot distinguish its old session from the new one.
 * - A present token must be a non-negative integer and must equal the
 *   current epoch exactly.
 *
 * The decision is a string-discriminated union (not a boolean flag) on
 * purpose: consumers compile under strictNullChecks:false, where boolean
 * literal types widen and cannot discriminate.
 */

export interface ScoringFenceInput {
  commandEpoch: number | null | undefined
  matchEpoch: number | null | undefined
}

export type ScoringFenceDecision = {
  status: "accepted"
} | {
  status: "rejected"
  reason: string
}

export const FENCE_RESYNC_MESSAGE = "A scorer handover occurred. Reload the scoring session before writing."

export function scorerFencingDecision(input: ScoringFenceInput): ScoringFenceDecision {
  const current = input.matchEpoch ?? 0
  if (!Number.isInteger(current) || current < 0) {
    return { status: "rejected", reason: "Match handover epoch is corrupt. Refusing to score until the league is reviewed." }
  }
  if (input.commandEpoch === null || input.commandEpoch === undefined) {
    if (current === 0) return { status: "accepted" }
    return { status: "rejected", reason: FENCE_RESYNC_MESSAGE }
  }
  if (!Number.isInteger(input.commandEpoch) || input.commandEpoch < 0) {
    return { status: "rejected", reason: "Invalid scoring session token. Reload the scoring session." }
  }
  if (input.commandEpoch !== current) {
    return { status: "rejected", reason: FENCE_RESYNC_MESSAGE }
  }
  return { status: "accepted" }
}
