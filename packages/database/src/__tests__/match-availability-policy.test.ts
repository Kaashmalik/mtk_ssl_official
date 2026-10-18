import { describe, expect, it } from "vitest"
import {
  AVAILABILITY_LABELS,
  availabilityDecision,
  availabilityLabel,
  isAvailabilityStatus,
} from "../lib/match-availability-policy"

describe("availability policy (Batch 138, REG-05)", () => {
  it("recognizes exactly the three recorded statuses", () => {
    expect(isAvailabilityStatus("available")).toBe(true)
    expect(isAvailabilityStatus("unavailable")).toBe(true)
    expect(isAvailabilityStatus("maybe")).toBe(true)
    expect(isAvailabilityStatus("definitely")).toBe(false)
    expect(isAvailabilityStatus("")).toBe(false)
    expect(Object.keys(AVAILABILITY_LABELS)).toHaveLength(3)
  })

  it("accepts any non-terminal match honestly", () => {
    expect(availabilityDecision({ tenantId: "t", status: "scheduled" })).toEqual({ ok: true })
    expect(availabilityDecision({ tenantId: "t", status: "live" })).toEqual({ ok: true })
    expect(availabilityDecision({ tenantId: "t", status: null })).toEqual({ ok: true })
  })

  it("refuses terminal matches - an availability answer after the fact is theatre", () => {
    for (const status of ["completed", "cancelled", "abandoned"]) {
      const decision = availabilityDecision({ tenantId: "t", status })
      expect(decision.ok).toBe(false)
      if (!decision.ok) expect(decision.reason).toMatch(/no longer be recorded/)
    }
  })

  it("labels unknown statuses as Unknown rather than inventing one", () => {
    expect(availabilityLabel("available")).toBe("Available")
    expect(availabilityLabel("weird")).toBe("Unknown")
  })
})
