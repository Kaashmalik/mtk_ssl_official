import { describe, expect, it } from "vitest"
import { calculateDeliveryDelta, scorerRunsToDelivery } from "../lib/scoring-delivery"

describe("Delivery run accounting", () => {
  it.each([
    { input: { runs: 0 }, total: 0, batter: 0, extras: 0, balls: 1 },
    { input: { runs: 4 }, total: 4, batter: 4, extras: 0, balls: 1 },
    { input: { runs: 1, isWide: true }, total: 1, batter: 0, extras: 1, balls: 0 },
    { input: { runs: 5, isWide: true }, total: 5, batter: 0, extras: 5, balls: 0 },
    { input: { runs: 1, isNoBall: true }, total: 1, batter: 0, extras: 1, balls: 0 },
    { input: { runs: 5, isNoBall: true }, total: 5, batter: 4, extras: 1, balls: 0 },
    { input: { runs: 7, isNoBall: true }, total: 7, batter: 6, extras: 1, balls: 0 },
    { input: { runs: 4, isBye: true }, total: 4, batter: 0, extras: 4, balls: 1 },
    { input: { runs: 2, isLegBye: true }, total: 2, batter: 0, extras: 2, balls: 1 },
  ])("accounts for $input without double counting", ({ input, total, batter, extras, balls }) => {
    expect(calculateDeliveryDelta(scorerRunsToDelivery(input))).toMatchObject({
      totalRuns: total, batterRuns: batter, extras, legalBalls: balls,
    })
  })

  it("counts a boundary off the bat on a no-ball, but never an extras-only boundary", () => {
    expect(calculateDeliveryDelta({ runs: 4, extras: { type: "noball", runs: 1 } }).isFour).toBe(true)
    expect(calculateDeliveryDelta({ runs: 0, extras: { type: "bye", runs: 4 } }).isFour).toBe(false)
    expect(calculateDeliveryDelta({ runs: 0, extras: { type: "wide", runs: 6 } }).isSix).toBe(false)
    expect(calculateDeliveryDelta({ runs: 0, extras: { type: "wide", runs: 5 } }).wides).toBe(5)
  })

  it.each([-1, 1.5, NaN, Infinity, 8])("rejects invalid runs %s", (runs) => {
    expect(() => calculateDeliveryDelta({ runs })).toThrow()
  })

  it("rejects contradictory extras flags and zero-run extras", () => {
    expect(() => scorerRunsToDelivery({ runs: 1, isWide: true, isNoBall: true })).toThrow("exactly one")
    expect(() => scorerRunsToDelivery({ runs: 0, isBye: true })).toThrow("at least one")
    expect(() => calculateDeliveryDelta({ runs: 1, extras: { type: "wide", runs: 1 } })).toThrow("Only no-balls")
  })
})
