/**
 * SCORE-13 (Batch 137): rich Match Center overlays derived from OFFICIAL
 * ball rows - never new reads, never invented facts. The public match page
 * already loads each innings' ball rows (wicket attribution for the FoW
 * map); these derivations fold over that exact array.
 *
 * Honesty rules:
 * - matchBalls rows carry `runs` and `isWicket` but NOT the extra type, so
 *   a wide is just a recorded delivery with its runs. Delivery counts here
 *   are RECORDED deliveries, never claimed legal deliveries.
 * - The partnership resets at every recorded wicket; without a recorded
 *   wicket it spans the innings (ball one onward).
 * - `recent` is bounded and CHRONOLOGICAL (oldest -> newest, like a TV
 *   strip), and an empty innings derives null rather than an empty pose.
 */

export const OVERLAY_LABELS = {
  partnership: "Partnership",
  recordedDeliveries: "recorded deliveries",
  sinceLastWicket: "since last wicket",
  ballOne: "ball one",
  recentBalls: "Recent balls",
  lastWicket: "Last wicket",
} as const

export type OverlayBallKind = "dot" | "run" | "four" | "six" | "wicket"

export interface OverlayBallChip {
  marker: string
  kind: OverlayBallKind
  title: string
}

export interface InningsOverlay {
  partnershipRuns: number
  partnershipDeliveries: number
  partnershipBasis: string
  lastWicketAt: string | null
  recent: OverlayBallChip[]
}

/** The marker language of the recent strip (same for every reader). */
export function overlayBallChip(b: { runs: number; isWicket: boolean }): OverlayBallChip {
  if (b.isWicket) return { marker: "W", kind: "wicket", title: "Wicket" }
  if (b.runs === 0) return { marker: "·", kind: "dot", title: "No run" }
  if (b.runs === 4) return { marker: "4", kind: "four", title: "Four" }
  if (b.runs === 6) return { marker: "6", kind: "six", title: "Six" }
  return { marker: String(b.runs), kind: "run", title: `${b.runs} run${b.runs === 1 ? "" : "s"}` }
}

const RECENT_LIMIT = 12

/**
 * Derives the overlay for ONE innings from its recorded ball rows, in the
 * page's canonical order (ballSequence, then over/ball). Returns null for
 * an innings with no recorded rows - never an empty strip.
 */
export function deriveInningsOverlay(
  balls: ReadonlyArray<{ runs: number; isWicket: boolean; overNumber: number; ballNumber: number }>,
): InningsOverlay | null {
  if (balls.length === 0) return null

  let partnershipRuns = 0
  let partnershipDeliveries = 0
  let lastWicketAt: string | null = null

  for (const ball of balls) {
    partnershipRuns += ball.runs
    partnershipDeliveries += 1
    if (ball.isWicket) {
      // The wicket's own spot is WHERE the last wicket fell; the new
      // partnership starts after it.
      lastWicketAt = `${ball.overNumber}.${ball.ballNumber}`
      partnershipRuns = 0
      partnershipDeliveries = 0
    }
  }
  const recent = balls.slice(-RECENT_LIMIT).map(overlayBallChip)
  return {
    partnershipRuns,
    partnershipDeliveries,
    partnershipBasis: lastWicketAt ? OVERLAY_LABELS.sinceLastWicket : OVERLAY_LABELS.ballOne,
    lastWicketAt,
    recent,
  }
}
