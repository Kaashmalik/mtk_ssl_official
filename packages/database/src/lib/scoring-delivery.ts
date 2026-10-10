/** Pure delivery contract: safe to import from web, mobile, or the scoring service. */
export type ExtrasType = "wide" | "noball" | "bye" | "legbye"

export interface DeliveryRuns {
  /** Batter runs, excluding all extras. */
  runs: number
  extras?: { type: ExtrasType; runs: number }
}

export interface DeliveryDelta {
  totalRuns: number
  batterRuns: number
  extras: number
  legalBalls: number
  wides: number
  noBalls: number
  byes: number
  legByes: number
  isFour: boolean
  isSix: boolean
}

function requireRuns(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 7) {
    throw new Error(`${label} must be an integer between 0 and 7`)
  }
}

/** Converts explicit batter/extras runs to one authoritative aggregate delta. */
export function calculateDeliveryDelta(input: DeliveryRuns): DeliveryDelta {
  requireRuns(input.runs, "Batter runs")
  const type = input.extras?.type
  const extras = input.extras?.runs ?? 0
  requireRuns(extras, "Extra runs")
  if (type && !["wide", "noball", "bye", "legbye"].includes(type)) {
    throw new Error("Unsupported extras type")
  }
  if (type && extras < 1) throw new Error("Extras must include at least one run")
  if (type && type !== "noball" && input.runs !== 0) {
    throw new Error("Only no-balls can combine batter runs with extras")
  }

  return {
    totalRuns: input.runs + extras,
    batterRuns: input.runs,
    extras,
    legalBalls: type === "wide" || type === "noball" ? 0 : 1,
    // Scorecard extras breakdowns report runs, not the number of deliveries.
    wides: type === "wide" ? extras : 0,
    noBalls: type === "noball" ? extras : 0,
    byes: type === "bye" ? extras : 0,
    legByes: type === "legbye" ? extras : 0,
    isFour: input.runs === 4,
    isSix: input.runs === 6,
  }
}

export interface ScorerRunInput {
  /** The scorer UI stores total team runs for this delivery. */
  runs: number
  isWide?: boolean
  isNoBall?: boolean
  isBye?: boolean
  isLegBye?: boolean
}

/** Bridge the current total-run UI to the explicit service contract. */
export function scorerRunsToDelivery(input: ScorerRunInput): DeliveryRuns {
  requireRuns(input.runs, "Delivery runs")
  const flags = [input.isWide, input.isNoBall, input.isBye, input.isLegBye]
  if (flags.filter(Boolean).length > 1) {
    throw new Error("Choose exactly one extras type per delivery")
  }
  if (flags.some(Boolean) && input.runs < 1) {
    throw new Error("Extras must include at least one run")
  }
  if (input.isNoBall) return { runs: input.runs - 1, extras: { type: "noball", runs: 1 } }
  if (input.isWide) return { runs: 0, extras: { type: "wide", runs: input.runs } }
  if (input.isBye) return { runs: 0, extras: { type: "bye", runs: input.runs } }
  if (input.isLegBye) return { runs: 0, extras: { type: "legbye", runs: input.runs } }
  return { runs: input.runs }
}
