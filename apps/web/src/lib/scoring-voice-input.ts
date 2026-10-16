import type { BallInput } from "@/stores/scoring-store"

/** Voice wickets require the dedicated dismissal flow; never invent a wicket type. */
export function voiceDeliveryFlags(input: BallInput) {
  if (input === "W") return null
  return {
    input,
    runs: typeof input === "number" ? input : 1,
    isWicket: false,
    isWide: input === "WD",
    isNoBall: input === "NB",
    isBye: input === "B",
    isLegBye: input === "LB",
  }
}
