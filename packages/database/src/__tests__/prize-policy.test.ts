import { describe, expect, it } from "vitest"
import {
  isPrizePubliclyVisible,
  normalizePrizeAmount,
  prizeCanBeApproved,
  prizeCanBeEdited,
  prizePayoutRecordable,
} from "../lib/prize-policy"

describe("Tournament prize lifecycle policy (PUB-05)", () => {
  it("edits drafts only; approval freezes the row", () => {
    expect(prizeCanBeEdited({ status: "draft" })).toBe(true)
    expect(prizeCanBeEdited({ status: "approved" })).toBe(false)
    expect(prizeCanBeEdited({ status: null })).toBe(false)
    expect(prizeCanBeEdited(null)).toBe(false)
    expect(prizeCanBeApproved({ status: "draft" })).toBe(true)
    expect(prizeCanBeApproved({ status: "approved" })).toBe(false)
  })

  it("records a payout exactly once, on an approved prize only", () => {
    expect(prizePayoutRecordable({ status: "approved", recordedPayoutAt: null })).toBe(true)
    expect(prizePayoutRecordable({ status: "draft", recordedPayoutAt: null })).toBe(false)
    expect(prizePayoutRecordable({ status: "approved", recordedPayoutAt: new Date() })).toBe(false)
    expect(prizePayoutRecordable(null)).toBe(false)
  })

  it("shows only approved prizes for a published tournament", () => {
    expect(isPrizePubliclyVisible({ status: "approved" }, true)).toBe(true)
    expect(isPrizePubliclyVisible({ status: "draft" }, true)).toBe(false)
    expect(isPrizePubliclyVisible({ status: "approved" }, false)).toBe(false)
    expect(isPrizePubliclyVisible(null, true)).toBe(false)
  })

  it("normalizes amounts to exact 2dp strings and refuses malformed ones", () => {
    expect(normalizePrizeAmount("500")).toBe("500.00")
    expect(normalizePrizeAmount("1500.5")).toBe("1500.50")
    expect(normalizePrizeAmount("0.99")).toBe("0.99")
    expect(normalizePrizeAmount(" 12.25 ")).toBe("12.25")
    expect(normalizePrizeAmount("-5")).toBeNull()
    expect(normalizePrizeAmount("1.234")).toBeNull()
    expect(normalizePrizeAmount("abc")).toBeNull()
    expect(normalizePrizeAmount("")).toBeNull()
  })
})
