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

/**
 * Batch 103: which dismissals ask for the dismissing fielder.
 *
 * - `caught` → REQUIRED: the catcher is part of the official record (the
 *   bowler may be the catcher — caught and bowled — so the bowler id is a
 *   legitimate candidate).
 * - `run_out` / `stumped` → OPTIONAL: run-out relays can involve several
 *   fielders, and no surface observes a designated wicketkeeper, so the
 *   scorer may name or skip; the record never guesses one.
 * - Everything else (`bowled`, `lbw`, `hit_wicket`, `retired`,
 *   `retired_hurt`, junk) → NONE: no fielder effects the dismissal, an id
 *   arriving for one is smuggled data and is refused by
 *   `resolveWicketFielderId`.
 *
 * This is a UI-collection question only. The canonical service re-validates
 * any recorded `fielderId` against the FIELDING XI (scoring-write-access)
 * regardless of what the surface collected.
 */
export function wicketFielderRequirement(wicketType: string | null | undefined): "required" | "optional" | "none" {
  if (wicketType === "caught") return "required"
  if (wicketType === "run_out" || wicketType === "stumped") return "optional"
  return "none"
}

/** The scorer-facing question for a fielder-attribution step (shared by the
 *  web and mobile wicket flows so the wording cannot drift); null when the
 *  dismissal never asks. */
export function wicketFielderQuestion(wicketType: string | null | undefined): string | null {
  switch (wicketType) {
    case "caught":
      return "Who took the catch?"
    case "run_out":
      return "Who effected the run out?"
    case "stumped":
      return "Which wicketkeeper?"
    default:
      return null
  }
}

/**
 * Resolve the `wicketFielderId` to record for a dismissal. Mirrors the victim
 * rule: the chosen id must have been OFFERED (candidates come from the
 * fielding side; the service re-validates team membership) — an un-offered
 * or stale id is never written. A skipped optional question, an empty
 * candidate set, or a fielder-less dismissal all record WITHOUT attribution.
 * Candidates may be bare ids or `{ id }` records (e.g. squad entries).
 */
export function resolveWicketFielderId(input: {
  wicketType: string | null | undefined
  options: Array<string | { id: string }>
  chosenId?: string | null
}): string | null {
  if (wicketFielderRequirement(input.wicketType) === "none") return null
  if (input.options.length === 0) return null
  if (!input.chosenId) return null
  return input.options.some(option => typeof option === "string" ? option === input.chosenId : option.id === input.chosenId)
    ? input.chosenId
    : null
}
