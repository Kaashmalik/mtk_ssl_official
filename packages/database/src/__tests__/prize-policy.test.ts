import { describe, expect, it } from "vitest"
import {
  isPrizePubliclyVisible,
  prizeCanBeSuperseded,
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

  it("shows only approved, ACTIVE prizes for a published tournament (supersede fails closed)", () => {
    expect(isPrizePubliclyVisible({ status: "approved", supersededAt: null }, true)).toBe(true)
    expect(isPrizePubliclyVisible({ status: "draft", supersededAt: null }, true)).toBe(false)
    expect(isPrizePubliclyVisible({ status: "approved", supersededAt: null }, false)).toBe(false)
    expect(isPrizePubliclyVisible(null, true)).toBe(false)
    // A superseded prize is corrected history — never public.
    expect(isPrizePubliclyVisible({ status: "approved", supersededAt: new Date() }, true)).toBe(false)
    // Fail closed on an UNKNOWN supersede state: a reader that forgets the
    // column can never publicize a retired value.
    expect(isPrizePubliclyVisible({ status: "approved" }, true)).toBe(false)
  })

  it("supersedes only an approved, not-yet-superseded prize; unknown state fails closed", () => {
    expect(prizeCanBeSuperseded({ status: "approved", supersededAt: null })).toBe(true)
    expect(prizeCanBeSuperseded({ status: "draft", supersededAt: null })).toBe(false)
    expect(prizeCanBeSuperseded({ status: "approved", supersededAt: new Date() })).toBe(false)
    // Unknown supersede state (not selected): refuse, never guess.
    expect(prizeCanBeSuperseded({ status: "approved" })).toBe(false)
    expect(prizeCanBeSuperseded(null)).toBe(false)
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
