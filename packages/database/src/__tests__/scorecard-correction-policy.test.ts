import { describe, expect, it } from "vitest"
import {
  CORRECTION_REASON_LABELS,
  correctionReasonLabel,
  correctionRequestDecision,
  isCorrectionReason,
  isCorrectionStatus,
} from "../lib/scorecard-correction-policy"

describe("correction-request policy (Batch 141, REG-05)", () => {
  it("recognizes exactly the fixed reason set", () => {
    for (const reason of ["wrong_runs", "wrong_wicket", "wrong_batter", "missing_player", "other"]) {
      expect(isCorrectionReason(reason)).toBe(true)
    }
    expect(isCorrectionReason("free_text")).toBe(false)
    expect(isCorrectionReason("")).toBe(false)
    expect(Object.keys(CORRECTION_REASON_LABELS)).toHaveLength(5)
  })

  it("recognizes exactly the state machine's statuses", () => {
    for (const status of ["open", "approved", "dismissed"]) {
      expect(isCorrectionStatus(status)).toBe(true)
    }
    expect(isCorrectionStatus("maybe")).toBe(false)
  })

  it("accepts any scorecard-bearing match; refuses matches with no scorecard yet", () => {
    for (const status of ["toss", "live", "innings_break", "completed", null]) {
      expect(correctionRequestDecision({ tenantId: "t", status })).toEqual({ ok: true })
    }
    for (const status of ["draft", "registration"]) {
      const decision = correctionRequestDecision({ tenantId: "t", status })
      expect(decision.ok).toBe(false)
      if (!decision.ok) expect(decision.reason).toMatch(/no scorecard yet/)
    }
  })

  it("labels unknown reasons as Unknown rather than inventing one", () => {
    expect(correctionReasonLabel("wrong_runs")).toBe(CORRECTION_REASON_LABELS.wrong_runs)
    expect(correctionReasonLabel("weird")).toBe("Unknown")
  })
})
