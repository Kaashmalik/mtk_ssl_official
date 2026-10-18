/**
 * Match recap derivation (FAN-03, Batch 133).
 *
 * A recap is a DERIVED VIEW ONLY: every input is an official scorecard row
 * the public match page / scorecard have already loaded and publication-
 * gated. Nothing here reads the database, invents moments, or ranks beyond
 * deterministic tie-breaks (metric desc, then input order). A recap is null
 * whenever the official record cannot support one (no innings) - the caller
 * renders nothing rather than a fabricated summary.
 *
 * Highlights (video clips, media packages) remain out of scope: they need a
 * media pipeline the registers record as not built. This module is the
 * recap half of FAN-03.
 */

export const RECAP_FIFTY_RUNS = 50
export const RECAP_HUNDRED_RUNS = 100
export const RECAP_THREE_WICKETS = 3
export const RECAP_FIVE_WICKETS = 5

export type RecapMoment = {
  kind: "fifty" | "hundred" | "three_fors" | "five_for"
  playerName: string
  detail: string
}

export type MatchRecapInputInnings = {
  teamName: string
  /** Official inning totals from match_innings. */
  totalRuns: number
  totalWickets: number
  /** Official integer ball count - overs text derives from this, never floats. */
  totalBalls: number
  batting: ReadonlyArray<{ name: string; runs: number; balls: number }>
  /** `overs` is the official scorecard notation (4.2 = four overs, two balls). */
  bowling: ReadonlyArray<{ name: string; wickets: number; runs: number; overs: number }>
}

export type MatchRecapInput = {
  /** Official result text as the page renders it (already publication-safe). */
  resultText: string
  /** Player-of-the-match name, when the league recorded one. */
  manOfMatchName?: string | null
  innings: ReadonlyArray<MatchRecapInputInnings>
}

export type MatchRecap = {
  summary: string
  /** One top performer per innings per side of the ball (deterministic). */
  topBatters: Array<{ playerName: string; teamName: string; runs: number; balls: number }>
  topBowlers: Array<{ playerName: string; teamName: string; wickets: number; runs: number; overs: string }>
  moments: RecapMoment[]
}

function bestBatting(innings: MatchRecapInputInnings) {
  const rows = [...innings.batting].filter(row => typeof row.runs === "number" && row.runs > 0)
  rows.sort((a, b) => b.runs - a.runs || b.balls - a.balls)
  return rows[0] ?? null
}

function bestBowling(innings: MatchRecapInputInnings) {
  const rows = [...innings.bowling].filter(row => typeof row.wickets === "number" && row.wickets > 0)
  rows.sort((a, b) => b.wickets - a.wickets || a.runs - b.runs)
  return rows[0] ?? null
}

/** Cricket overs notation to text: integer balls -> "O.V" (e.g. 128 -> "21.2"). */
function ballsToOversText(totalBalls: number): string {
  if (!Number.isFinite(totalBalls) || totalBalls <= 0) return "0.0"
  return `${Math.floor(totalBalls / 6)}.${totalBalls % 6}`
}

/** Official scorecard overs notation (4.2) to integer balls (26); malformed keeps 0. */
function oversNotationToBalls(overs: number): number {
  if (!Number.isFinite(overs) || overs < 0) return 0
  const whole = Math.floor(overs + 1e-9)
  const balls = Math.round((overs - whole) * 10)
  return whole * 6 + balls
}

/**
 * Derive the recap or null from official rows only. A player's highest
 * bracket wins one moment (a hundred is not also a fifty; a five-for is not
 * also a three-for).
 */
export function deriveMatchRecap(input: MatchRecapInput): MatchRecap | null {
  const innings = (input.innings ?? []).filter(
    inn => inn && Number.isFinite(inn.totalRuns) && inn.totalRuns >= 0,
  )
  if (innings.length === 0) return null

  const summaryScores = innings
    .map(inn =>
      `${inn.teamName} ${inn.totalRuns}${Number.isFinite(inn.totalWickets) && inn.totalWickets > 0 ? `/${inn.totalWickets}` : ""} (${ballsToOversText(inn.totalBalls)} ov)`,
    )
    .join(", ")
  const mom = input.manOfMatchName ? ` ${input.manOfMatchName} was named player of the match.` : ""
  const summary = `${input.resultText || "Match completed"}. Scores: ${summaryScores}.${mom}`.replace(/\s+/g, " ").trim()

  const topBatters = innings
    .map(inn => {
      const best = bestBatting(inn)
      return best
        ? { playerName: best.name, teamName: inn.teamName, runs: best.runs, balls: best.balls }
        : null
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)

  const topBowlers = innings
    .map(inn => {
      const best = bestBowling(inn)
      return best
        ? { playerName: best.name, teamName: inn.teamName, wickets: best.wickets, runs: best.runs, overs: ballsToOversText(oversNotationToBalls(best.overs)) }
        : null
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)

  const moments: RecapMoment[] = []
  for (const inn of innings) {
    for (const row of inn.batting) {
      if (row.runs >= RECAP_HUNDRED_RUNS && Number.isFinite(row.runs)) {
        moments.push({ kind: "hundred", playerName: row.name, detail: `${row.runs} off ${row.balls} balls` })
      } else if (row.runs >= RECAP_FIFTY_RUNS && Number.isFinite(row.runs)) {
        moments.push({ kind: "fifty", playerName: row.name, detail: `${row.runs} off ${row.balls} balls` })
      }
    }
    for (const row of inn.bowling) {
      if (row.wickets >= RECAP_FIVE_WICKETS && Number.isFinite(row.wickets)) {
        moments.push({ kind: "five_for", playerName: row.name, detail: `${row.wickets}/${row.runs}` })
      } else if (row.wickets >= RECAP_THREE_WICKETS && Number.isFinite(row.wickets)) {
        moments.push({ kind: "three_fors", playerName: row.name, detail: `${row.wickets}/${row.runs}` })
      }
    }
  }

  return { summary, topBatters, topBowlers, moments }
}

export const RECAP_LABELS = {
  title: "Match Recap",
  summary: "Summary",
  topBatters: "Top batting",
  topBowlers: "Top bowling",
  moments: "Key moments",
  momentLabels: {
    fifty: "Fifty",
    hundred: "Century",
    three_fors: "Three wickets",
    five_for: "Five-wicket haul",
  },
  derivedNotice: "Derived automatically from the official scorecard rows - never a fabricated narrative.",
} as const
