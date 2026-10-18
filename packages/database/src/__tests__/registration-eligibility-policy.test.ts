import { describe, expect, it } from "vitest"
import {
  canApproveRegistration,
  canRejectRegistration,
  canSetPaymentStatus,
  describeEligibility,
  evaluateSquadEligibility,
  sameLeague,
} from "../lib/registration-eligibility-policy"

describe("registration eligibility policy (Batch 148, REG-04)", () => {
  it("eligibility requires approval, paid/waived status, and a full squad", () => {
    const ok = evaluateSquadEligibility({ approvalStatus: "approved", paymentStatus: "paid", squadSize: 11, minSquadSize: 11 })
    expect(ok).toEqual({ eligible: true, blockers: [] })
  })

  it("every blocker is named rather than a generic 'ineligible'", () => {
    const r = evaluateSquadEligibility({ approvalStatus: "pending", paymentStatus: "unpaid", squadSize: 3, minSquadSize: 11 })
    expect(r.eligible).toBe(false)
    expect(r.blockers).toContain("registration must be approved")
    expect(r.blockers).toContain("registration fee must be paid or waived")
    expect(r.blockers).toContain("squad must have at least 11 players (currently 3)")
  })

  it("waived counts as paid for eligibility; refunded does not", () => {
    expect(evaluateSquadEligibility({ approvalStatus: "approved", paymentStatus: "waived", squadSize: 11, minSquadSize: 11 }).eligible).toBe(true)
    expect(evaluateSquadEligibility({ approvalStatus: "approved", paymentStatus: "refunded", squadSize: 11, minSquadSize: 11 }).eligible).toBe(false)
  })

  it("approval/rejection are transitions; re-approving a rejected registration is refused", () => {
    expect(canApproveRegistration("pending")).toBe(true)
    expect(canApproveRegistration("waitlisted")).toBe(true)
    expect(canApproveRegistration("approved")).toBe(false)
    expect(canApproveRegistration("rejected")).toBe(false)
    expect(canRejectRegistration("pending")).toBe(true)
    expect(canRejectRegistration("approved")).toBe(false)
  })

  it("payment states only move forward; never silently refunded", () => {
    expect(canSetPaymentStatus("unpaid", "paid")).toBe(true)
    expect(canSetPaymentStatus("unpaid", "waived")).toBe(true)
    expect(canSetPaymentStatus("paid", "refunded")).toBe(true)
    expect(canSetPaymentStatus("paid", "unpaid")).toBe(false)
    expect(canSetPaymentStatus("refunded", "paid")).toBe(false)
  })

  it("cross-tenant bindings are refused outright", () => {
    expect(sameLeague("t1", "t1")).toBe(true)
    expect(sameLeague("t1", "t2")).toBe(false)
    expect(sameLeague("", "t2")).toBe(false)
  })

  it("the member-facing sentence joins blockers verbatim", () => {
    const r = evaluateSquadEligibility({ approvalStatus: "pending", paymentStatus: "unpaid", squadSize: 2, minSquadSize: 5 })
    expect(describeEligibility(r)).toMatch(/registration must be approved/)
    expect(describeEligibility({ eligible: true, blockers: [] })).toBe("Squad is eligible for this tournament.")
  })
})
