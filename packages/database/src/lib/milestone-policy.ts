/**
 * FAN-03 milestone policy (pure).
 *
 * Milestones are DERIVED FACTS about already-recorded official scorecard
 * rows - a century is a batting innings of 100+ runs, a five-wicket haul is
 * a bowling innings of 5+ wickets ("five-for or better"). Nothing is stored:
 * the derivation replays verifiable scorecard rows through the publication
 * gate, so a milestone can never exist without its official row.
 *
 * Milestones are fan-facing CELEBRATION surfaces only: they feed no
 * standings, award, or official decision.
 */

/** One public milestone section shows at most this many entries. */
export const MILESTONE_LIMIT = 10

export type MilestoneCenturyInput = { runs: number | null | undefined }
export type MilestoneFiveForInput = { wickets: number | null | undefined }

/** A century: an integer runs value of 100 or more (100*, 200, anything). */
export function isMilestoneCentury({ runs }: MilestoneCenturyInput): boolean {
  return typeof runs === "number" && Number.isInteger(runs) && runs >= 100
}

/** A five-for-or-better: an integer wickets value of 5 or more. */
export function isMilestoneFiveFor({ wickets }: MilestoneFiveForInput): boolean {
  return typeof wickets === "number" && Number.isInteger(wickets) && wickets >= 5
}

export type MilestoneEntry = {
  playerId: string
  playerName: string
  playerVerified: boolean
  /** The verified fact itself: runs for a century, wickets for a five-for. */
  value: number
  /** ISO timestamp of the scorecard row's creation - ordering truth, not display truth. */
  recordedAt: string
}

/** Deterministic milestone ordering: best value first, then stable id order. */
export function compareMilestoneEntries(a: MilestoneEntry, b: MilestoneEntry): number {
  if (b.value !== a.value) return b.value - a.value
  return a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0
}
