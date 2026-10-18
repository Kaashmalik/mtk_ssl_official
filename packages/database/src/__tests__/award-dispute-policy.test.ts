import { describe, expect, it } from "vitest"
import {
  AWARD_DISPUTE_REASONS, AWARD_DISPUTE_REASON_LABELS,
  isAwardDisputeReason, canResolveDispute, disputeStatusLabels,
} from "../lib/award-dispute-policy"

describe("Award dispute policy (PUB-04)", () => {
  it("exposes a fixed, non-empty reason set with a display label for every reason", () => {
    expect(AWARD_DISPUTE_REASONS.length).toBeGreaterThan(0)
    expect(new Set(AWARD_DISPUTE_REASONS).size).toBe(AWARD_DISPUTE_REASONS.length)
    for (const reason of AWARD_DISPUTE_REASONS) {
      expect(typeof AWARD_DISPUTE_REASON_LABELS[reason]).toBe("string")
      expect(AWARD_DISPUTE_REASON_LABELS[reason].length).toBeGreaterThan(0)
    }
  })

  it("recognizes exactly the declared reasons and nothing else", () => {
    for (const reason of AWARD_DISPUTE_REASONS) expect(isAwardDisputeReason(reason)).toBe(true)
    expect(isAwardDisputeReason("free_text_grudge")).toBe(false)
    expect(isAwardDisputeReason("")).toBe(false)
    expect(isAwardDisputeReason(42)).toBe(false)
    expect(isAwardDisputeReason(null)).toBe(false)
  })

  it("lets only OPEN disputes be resolved — decisions are terminal", () => {
    expect(canResolveDispute({ status: "open" })).toBe(true)
    expect(canResolveDispute({ status: "upheld" })).toBe(false)
    expect(canResolveDispute({ status: "dismissed" })).toBe(false)
    // Missing or malformed rows fail closed.
    expect(canResolveDispute(null)).toBe(false)
    expect(canResolveDispute(undefined)).toBe(false)
  })

  it("labels every dispute status for honest UI display", () => {
    expect(disputeStatusLabels("open")).toContain("Awaiting")
    expect(disputeStatusLabels("upheld")).toContain("Upheld")
    expect(disputeStatusLabels("dismissed")).toContain("award stands")
  })
})
