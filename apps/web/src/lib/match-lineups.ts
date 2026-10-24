/**
 * Batch 137: the match centre's announced playing XIs — a pure, read-only
 * fold over the declared `match_playing_xis` rows (COMP-06 slices own the
 * writing; this owns the PUBLIC view).
 *
 * The rules mirror what an announced lineup IS:
 *  - A side renders only as a COMPLETE declaration — exactly 11 active
 *    rows (the reader passes only `supersededIs null` rows, but the fold
 *    re-checks) whose batting orders are the permutation 1..11. Anything
 *    partial, duplicated or out-of-range is not an XI; it renders as
 *    "not announced" rather than a near-empty list dressed up as truth.
 *  - Names arrive ONLY through the caller's map — the same single
 *    minor-consent-gated name read the scorecards use. The fold never
 *    invents a name ("Unknown Player" is the honest fallback it inherits
 *    from the rest of the page) and never consults the database.
 *  - The designated keeper is marked only when the side has EXACTLY one;
 *    a corrupt double-claim marks nobody rather than showing a guess.
 *  - A stranger team's rows can never surface on either side (defensive
 *    filter; the reader already scopes to the match's two teams).
 *  - A declared-but-unapproved state is carried as the caller's verdict
 *    (`xiRequired && !xiIsApproved` from the shared policy) so the card
 *    can say "awaiting official approval" — the fold adds no semantics.
 *
 * Both sides absent (or no rows at all) yields null: no card, no claim.
 */

export const XI_SIZE = 11

export type XiRow = {
  teamId: string
  playerId: string
  battingOrder: number
  wicketkeeper: boolean
}

export type LineupSide = {
  players: { name: string; wicketkeeper: boolean }[]
}

export type MatchLineups = {
  /** Declared but not yet confirmed by an official (shared xi policy). */
  awaitingApproval: boolean
  a: LineupSide | null
  b: LineupSide | null
}

export const LINEUP_DISCLOSURE =
  "Lineups are shown exactly as declared by the league; a substitution replaces the previous player in the same slot."

export function buildMatchLineups(
  rows: XiRow[],
  aId: string,
  bId: string,
  nameById: ReadonlyMap<string, string>,
  awaitingApproval: boolean,
): MatchLineups | null {
  if (!aId || !bId || aId === bId) return null

  const side = (teamId: string): LineupSide | null => {
    const teamRows = rows.filter((r) => r && r.teamId === teamId)
    if (teamRows.length !== XI_SIZE) return null
    const orders = teamRows.map((r) => r.battingOrder)
    const distinct = new Set(orders)
    if (distinct.size !== XI_SIZE) return null
    if (orders.some((o) => !Number.isInteger(o) || o < 1 || o > XI_SIZE)) return null
    const keepers = teamRows.filter((r) => r.wicketkeeper === true).length
    const markKeeper = keepers === 1
    return {
      players: [...teamRows]
        .sort((x, y) => x.battingOrder - y.battingOrder)
        .map((r) => ({
          name: nameById.get(r.playerId) ?? "Unknown Player",
          wicketkeeper: markKeeper && r.wicketkeeper === true,
        })),
    }
  }

  const a = side(aId)
  const b = side(bId)
  if (!a && !b) return null
  return { awaitingApproval, a, b }
}
