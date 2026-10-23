/**
 * Batch 102: shared wicket-victim attribution policy (ENH-03-02 follow-up).
 *
 * Batch 100 gave the official record optional `wicket_player_out_id`/
 * `wicket_fielder_id` attribution and the WEB scoring screen a run-out
 * "Which batter is out?" picker fed by the last service-confirmed crease
 * ack. Mobile now asks the same question against the SAME rules; the rule
 * itself therefore lives here - one shared implementation, never a web copy
 * and a mobile copy that can drift.
 *
 * Semantics (unchanged from Batch 100):
 * - In dismissals where the batter who left is rule-fixed to the STRIKER
 *   (they faced the ball: bowled, caught, lbw, stumped, hit_wicket), the
 *   scorer is never asked; the server fold attributs the striker.
 * - Only `run_out` can leave either crease occupant, so it alone requires
 *   the scorer to name the batter who left.
 * - The picker is offered ONLY from a CONFIRMED participants projection
 *   (the last service-confirmed acknowledgement). Without one, the record
 *   is written WITHOUT a victim id and the server-side fold default
 *   (striker) applies, then self-heals on the next record - the device
 *   never invents a canonical claim it has not observed.
 */
import type { ScoringParticipants } from "./scoring"

/** A candidate victim the scorer may name: a confirmed crease occupant. */
export type WicketVictimOption = {
  id: string
  onStrike: boolean
}

/**
 * Dismissal types whose victim is rule-fixed to the striker (they faced the
 * ball). Only run_out needs the scorer to name the batter who left.
 */
export function wicketRequiresVictimAttribution(wicketType: string | null | undefined): boolean {
  return wicketType === "run_out"
}

/**
 * Victim candidates from the LAST service-confirmed crease projection.
 * Accepts the full `ScoringParticipants` or any structural subset carrying
 * these three observed fields (e.g. a device-cached acknowledgement).
 * Returns [] for null, an unconfirmed fold, or a projection without a
 * confirmed striker - callers must NOT fall back to their own rotation
 * guess; the server fold owns that decision.
 */
export function victimOptionsFromParticipants(
  participants: Pick<ScoringParticipants, "strikerId" | "nonStrikerId" | "confirmed"> | null | undefined,
): WicketVictimOption[] {
  if (!participants || participants.confirmed !== true || !participants.strikerId) return []
  const options: WicketVictimOption[] = [{ id: participants.strikerId, onStrike: true }]
  const nonStriker = participants.nonStrikerId
  if (nonStriker && nonStriker !== participants.strikerId) {
    options.push({ id: nonStriker, onStrike: false })
  }
  return options
}

/**
 * Resolve the `wicketPlayerOutId` to record for a queued delivery.
 *
 * Returns null (record WITHOUT attribution → server-fold default +
 * self-heal) whenever the rule does not ask, the confirmed crease is not
 * available, or the chosen id is not one of the offered candidates. An
 * id that was never offered must never be smuggled into the record.
 */
export function resolveWicketVictimId(input: {
  wicketType: string | null | undefined
  options: WicketVictimOption[]
  chosenId?: string | null
}): string | null {
  if (!wicketRequiresVictimAttribution(input.wicketType)) return null
  if (input.options.length < 2) return null
  if (!input.chosenId) return null
  return input.options.some(option => option.id === input.chosenId)
    ? input.chosenId
    : null
}
