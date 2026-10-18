import { describe, expect, it } from "vitest"
import {
  APPLICATION_LIVE_STATES,
  canResubmit,
  describeApplicationStatus,
  isLiveStatus,
  isTerminalStatus,
  memberMove,
  ownerMove,
  resolveOwnerDecision,
} from "../lib/tournament-application-policy"

describe("tournament-application policy (Batch 147, REG-03)", () => {
  it("state partition: exactly the documented live and terminal sets", () => {
    expect(APPLICATION_LIVE_STATES).toEqual(["submitted", "needs_information", "waitlisted"])
    for (const s of ["submitted", "needs_information", "waitlisted"]) {
      expect(isLiveStatus(s)).toBe(true)
      expect(isTerminalStatus(s)).toBe(false)
    }
    for (const s of ["approved", "declined", "withdrawn"]) {
      expect(isTerminalStatus(s)).toBe(true)
      expect(isLiveStatus(s)).toBe(false)
    }
    expect(isLiveStatus("open")).toBe(false) // B141's vocabulary does not leak in
  })

  it("the member's only move is withdrawal, and only from a live state", () => {
    expect(memberMove("submitted", "withdraw")).toBe("withdrawn")
    expect(memberMove("needs_information", "withdraw")).toBe("withdrawn")
    expect(memberMove("waitlisted", "withdraw")).toBe("withdrawn")
    expect(memberMove("approved", "withdraw")).toBeNull()
    expect(memberMove("withdrawn", "withdraw")).toBeNull()
    // No member self-approval exists.
    expect(memberMove("submitted", "approve" as never)).toBeNull()
  })

  it("owner decisions are a fixed vocabulary mapping to exact states", () => {
    expect(resolveOwnerDecision("approve")).toBe("approved")
    expect(resolveOwnerDecision("request_information")).toBe("needs_information")
    expect(resolveOwnerDecision("waitlist")).toBe("waitlisted")
    expect(resolveOwnerDecision("decline")).toBe("declined")
    expect(resolveOwnerDecision("whatever")).toBeNull()
  })

  it("owner moves apply to live applications only; terminal history is never re-decided", () => {
    expect(ownerMove("submitted", "approve")).toBe("approved")
    expect(ownerMove("waitlisted", "decline")).toBe("declined")
    expect(ownerMove("needs_information", "waitlist")).toBe("waitlisted")
    expect(ownerMove("approved", "decline")).toBeNull()
    expect(ownerMove("withdrawn", "approve")).toBeNull()
    expect(ownerMove("declined", "request_information")).toBeNull()
  })

  it("resubmission is a NEW row and requires the previous application terminal", () => {
    expect(canResubmit("withdrawn")).toBe(true)
    expect(canResubmit("declined")).toBe(true)
    expect(canResubmit("approved")).toBe(true) // one live row only; a new application would refuse on approval
    expect(canResubmit("submitted")).toBe(false)
    expect(canResubmit("waitlisted")).toBe(false)
  })

  it("the member-facing sentences state facts, including the needs_information answer path", () => {
    expect(describeApplicationStatus("needs_information")).toMatch(/Withdraw and resubmit/)
    expect(describeApplicationStatus("declined")).toMatch(/may not resubmit/)
    expect(describeApplicationStatus("withdrawn")).toMatch(/new application/)
    expect(describeApplicationStatus("waitlisted")).toMatch(/slot opens/)
  })
})
