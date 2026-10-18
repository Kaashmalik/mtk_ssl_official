import { describe, expect, it } from "vitest"
import { deriveInningsOverlay, overlayBallChip, OVERLAY_LABELS } from "../lib/match-overlays"

const ball = (runs: number, isWicket = false, overNumber = 1, ballNumber = 1) =>
  ({ runs, isWicket, overNumber, ballNumber })

describe("overlay ball chips", () => {
  it("marks dots, fours, sixes, runs and wickets distinctly", () => {
    expect(overlayBallChip(ball(0, false))).toMatchObject({ marker: "·", kind: "dot" })
    expect(overlayBallChip(ball(4))).toMatchObject({ marker: "4", kind: "four" })
    expect(overlayBallChip(ball(6))).toMatchObject({ marker: "6", kind: "six" })
    expect(overlayBallChip(ball(2))).toMatchObject({ marker: "2", kind: "run" })
    expect(overlayBallChip(ball(1))).toMatchObject({ marker: "1", kind: "run" })
    expect(overlayBallChip(ball(0, true))).toMatchObject({ marker: "W", kind: "wicket" })
  })
})

describe("deriveInningsOverlay folds over recorded ball rows (Batch 137, SCORE-13)", () => {
  it("null for an innings with no recorded rows - never an empty strip", () => {
    expect(deriveInningsOverlay([])).toBeNull()
  })

  it("partnership spans ball one when no wicket was recorded", () => {
    const overlay = deriveInningsOverlay([ball(1, false, 1, 1), ball(4, false, 1, 2), ball(0, false, 1, 3)])!
    expect(overlay.partnershipRuns).toBe(5)
    expect(overlay.partnershipDeliveries).toBe(3)
    expect(overlay.partnershipBasis).toBe(OVERLAY_LABELS.ballOne)
    expect(overlay.lastWicketAt).toBeNull()
  })

  it("resets the partnership at a recorded wicket and points at its spot", () => {
    const overlay = deriveInningsOverlay([
      ball(1, false, 1, 1), ball(4, false, 1, 2),
      ball(0, true, 1, 3),                       // wicket falls at 1.3
      ball(2, false, 2, 1), ball(6, false, 2, 2),
    ])!
    expect(overlay.partnershipRuns).toBe(8)
    expect(overlay.partnershipDeliveries).toBe(2)
    expect(overlay.partnershipBasis).toBe(OVERLAY_LABELS.sinceLastWicket)
    expect(overlay.lastWicketAt).toBe("1.3")
  })

  it("counts every recorded delivery honestly (extras carry runs, never claimed legal)", () => {
    // 7 recorded rows incl. a wicket: counts are RECORDED deliveries, and
    // the policy never claims legality it cannot see.
    const overlay = deriveInningsOverlay([
      ball(1), ball(1), ball(1), ball(0, true, 2, 4), ball(1), ball(1), ball(1),
    ])!
    expect(overlay.partnershipDeliveries).toBe(3)
    expect(overlay.lastWicketAt).toBe("2.4")
  })

  it("the recent strip is bounded to the last 12 and CHRONOLOGICAL", () => {
    const balls = Array.from({ length: 20 }, (_, i) => ball(i % 7, i === 9, Math.floor(i / 6) + 1, (i % 6) + 1))
    const overlay = deriveInningsOverlay(balls)!
    expect(overlay.recent).toHaveLength(12)
    expect(overlay.recent[0]).toMatchObject({ marker: "1", kind: "run" })   // ball index 8: oldest in the window
    expect(overlay.recent[1]).toMatchObject({ marker: "W", kind: "wicket" }) // ball index 9: the wicket (at 2.4)
    expect(overlay.recent[11]).toMatchObject({ marker: "5", kind: "run" })  // ball index 19: newest (19 % 7)
    expect(overlay.lastWicketAt).toBe("2.4")
  })

  it("derives despite a wicket as the last recorded delivery (new partnership = zero, honestly)", () => {
    const overlay = deriveInningsOverlay([ball(4, false, 3, 1), ball(0, true, 3, 2)])!
    expect(overlay.partnershipRuns).toBe(0)
    expect(overlay.partnershipDeliveries).toBe(0)
    expect(overlay.lastWicketAt).toBe("3.2")
  })

  it("overlayBallChip covers every kind the strip can render", () => {
    const markers = [0, 1, 2, 3, 4, 5, 6, 7].map(r => overlayBallChip(ball(r, false)).marker)
    expect(markers).toEqual(["·", "1", "2", "3", "4", "5", "6", "7"])
  })
})
