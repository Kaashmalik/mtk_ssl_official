/**
 * FAN-03 (Batch 165): the "approved analytic package" - the form guide.
 * A DELIBERATELY modest, fully honest package: per-team recent form derived
 * ONLY from official published match rows (status + winnerId), folded by
 * fixed rules, labeled derived, recalculated on every read. It contains no
 * opinion, no prediction, and nothing a league did not already publish:
 * the package consumes the same official facts the standings consume, and
 * an unplayed/underway match can never contribute a form letter.
 */

export const FORM_GUIDE_RULE_VERSION = 1

/** Official result states that produce a form letter. */
export const FORM_GUIDE_RESULTED = ["completed"] as const
/** Official states that count a match but produce an honest no-verdict letter. */
export const FORM_GUIDE_VOIDED = ["abandoned", "cancelled", "no_result", "forfeited", "postponed"] as const

export type FormLetter = "W" | "L" | "N"

export type FormGuideMatchInput = {
  id: string
  status: string
  scheduledDate: Date | string | null
  teamAId: string
  teamBId: string
  winnerId: string | null
  /** The official result echo - shown verbatim, never rewritten. */
  resultText: string | null
}

export type FormGuideEntry = {
  matchId: string
  letter: FormLetter
  opponentName: string
  resultText: string | null
  playedOn: string | null
}

export type FormGuideRow = {
  teamId: string
  teamName: string
  /** Most recent first, capped at the window. */
  sequence: FormGuideEntry[]
  played: number
  won: number
  lost: number
  noVerdict: number
  /** Trailing run of identical letters from the most recent match. */
  streak: { letter: FormLetter; length: number } | null
}

export const FORM_GUIDE_WINDOW = 5

export const FORM_GUIDE_DISCLOSURE =
  "Derived automatically from official published results only - recalculated on every page view, with no editorial input. N marks a tie or a voided match: an honest no-verdict, never a guess."

function sortForRecency(a: FormGuideMatchInput, b: FormGuideMatchInput): number {
  const at = a.scheduledDate ? new Date(a.scheduledDate).getTime() : 0
  const bt = b.scheduledDate ? new Date(b.scheduledDate).getTime() : 0
  // Most recent first; without a recorded date, the (time-ordered uuidv7)
  // match id descends - later record = more recent fact, deterministically.
  if (bt !== at) return bt - at
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0
}

function letterFor(teamId: string, opponentId: string, match: FormGuideMatchInput): FormLetter {
  if (match.status === "completed" && match.winnerId) {
    return match.winnerId === teamId ? "W" : match.winnerId === opponentId ? "L" : "N"
  }
  // Completed without a recorded winner (e.g. a tied format) and every
  // voided state are honest no-verdicts - never a guessed wrongness.
  return "N"
}

/**
 * The whole package in one pure fold. Consumption rules, pinned:
 * - ONLY resulted/voided official matches contribute (an upcoming or
 *   in-progress match has no form letter to give).
 * - One appearance per team per match; both teams see the same event from
 *   their own side (play counts once per team, not once per side).
 * - The sequence is the recency window; streak counts trailing identical
 *   letters from the most recent entry (voids are real letters in the
 *   sequence but never inflate a W or L claim).
 * - A team with zero counted matches is absent - honest absence.
 */
export function computeFormGuide(
  matches: FormGuideMatchInput[],
  teamNamesById: ReadonlyMap<string, string>,
): FormGuideRow[] {
  const counted = matches
    .filter(
      (m) =>
        (FORM_GUIDE_RESULTED as readonly string[]).includes(m.status)
        || (FORM_GUIDE_VOIDED as readonly string[]).includes(m.status),
    )
    .sort(sortForRecency)

  const byTeam = new Map<string, FormGuideEntry[]>()
  for (const match of counted) {
    for (const [teamId, opponentId] of [
      [match.teamAId, match.teamBId],
      [match.teamBId, match.teamAId],
    ] as const) {
      if (!teamNamesById.has(teamId)) continue
      const entry: FormGuideEntry = {
        matchId: match.id,
        letter: letterFor(teamId, opponentId, match),
        opponentName: teamNamesById.get(opponentId) ?? "Unknown team",
        resultText: match.resultText,
        playedOn: match.scheduledDate ? new Date(match.scheduledDate).toISOString() : null,
      }
      const list = byTeam.get(teamId) ?? (byTeam.set(teamId, []), byTeam.get(teamId)!)
      list.push(entry)
    }
  }

  const rows: FormGuideRow[] = []
  for (const [teamId, entries] of byTeam) {
    const sequence = entries.slice(0, FORM_GUIDE_WINDOW)
    let won = 0
    let lost = 0
    let noVerdict = 0
    for (const entry of entries) {
      if (entry.letter === "W") won++
      else if (entry.letter === "L") lost++
      else noVerdict++
    }
    const first = sequence[0]
    let streak: FormGuideRow["streak"] = null
    if (first) {
      let length = 1
      while (length < sequence.length && sequence[length].letter === first.letter) length++
      streak = { letter: first.letter, length }
    }
    rows.push({
      teamId,
      teamName: teamNamesById.get(teamId) ?? "Unknown team",
      sequence,
      played: entries.length,
      won,
      lost,
      noVerdict,
      streak,
    })
  }
  rows.sort((a, b) => a.teamName.localeCompare(b.teamName))
  return rows
}
