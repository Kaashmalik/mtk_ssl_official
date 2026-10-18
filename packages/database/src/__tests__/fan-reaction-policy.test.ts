import { describe, expect, it } from "vitest"
import {
  FAN_REACTION_TYPES, isFanReactionType, reactionRateDecision,
  reactionTargetDecision, FAN_REACTION_MAX_PER_WINDOW, FAN_REACTION_LABELS,
  isReactionReportReason, reactionReportDecision, fanReportRateDecision,
  FAN_REPORT_MAX_PER_WINDOW, REACTION_REPORT_REASONS, REACTION_REPORT_REASON_LABELS,
  isFanBlockReason, fanBlockLiftDecision, fanBlockEnforcement,
  FAN_BLOCK_REASONS, FAN_BLOCK_REASON_LABELS,
} from "../lib/fan-reaction-policy"

describe("Fan reaction policy (FAN-01)", () => {
  it("exposes a fixed, labelled, non-official reaction set with no free text", () => {
    expect(FAN_REACTION_TYPES).toEqual(["four", "six", "wicket", "clap", "fire"])
    for (const type of FAN_REACTION_TYPES) {
      expect(typeof FAN_REACTION_LABELS[type]).toBe("string")
      expect(FAN_REACTION_LABELS[type].length).toBeGreaterThan(0)
    }
    expect(isFanReactionType("four")).toBe(true)
    expect(isFanReactionType("FIRE")).toBe(false) // case-pinned: no surprises at the DB CHECK.
    expect(isFanReactionType("offensive-thing")).toBe(false)
    expect(isFanReactionType(42)).toBe(false)
  })

  it("rate-limits flood adds at the shared floor and never limits removals (removals are not abuse)", () => {
    expect(reactionRateDecision(0)).toEqual({ allowed: true, reason: "ok" })
    expect(reactionRateDecision(FAN_REACTION_MAX_PER_WINDOW - 1)).toEqual({ allowed: true, reason: "ok" })
    expect(reactionRateDecision(FAN_REACTION_MAX_PER_WINDOW)).toEqual({ allowed: false, reason: "rate_limited" })
    expect(reactionRateDecision(9999)).toEqual({ allowed: false, reason: "rate_limited" })
  })

  it("admits published, played or playable matches", () => {
    for (const matchStatus of ["scheduled", "toss", "live", "innings_break", "completed", "abandoned", "no_result"]) {
      const decision = reactionTargetDecision({ matchStatus, tournamentStatus: "live" })
      expect(decision).toEqual({ allowed: true, reason: "ok" })
    }
  })

  it("refuses unpublished targets - including cancelled fixtures, per the house publication gate", () => {
    expect(reactionTargetDecision({ matchStatus: "live", tournamentStatus: "draft" }))
      .toEqual({ allowed: false, reason: "target_unpublished" })
    expect(reactionTargetDecision({ matchStatus: "draft", tournamentStatus: "live" }))
      .toEqual({ allowed: false, reason: "target_unpublished" })
    // Cancelled is outside the published match statuses, so it refuses too.
    expect(reactionTargetDecision({ matchStatus: "cancelled", tournamentStatus: "completed" }))
      .toEqual({ allowed: false, reason: "target_unpublished" })
  })
})

describe("Fan reaction report policy (FAN-01 reports slice)", () => {
  it("exposes a fixed, labelled report reason set with no free text", () => {
    expect(REACTION_REPORT_REASONS).toEqual(["abusive", "spam", "inappropriate", "other"])
    for (const reason of REACTION_REPORT_REASONS) {
      expect(REACTION_REPORT_REASON_LABELS[reason].length).toBeGreaterThan(0)
    }
    expect(isReactionReportReason("spam")).toBe(true)
    expect(isReactionReportReason("SPAM")).toBe(false) // case-pinned: no surprises at the DB CHECK.
    expect(isReactionReportReason("free text here")).toBe(false)
    expect(isReactionReportReason(null)).toBe(false)
  })

  it("decides only open reports; decided states are terminal and the decision must be known", () => {
    expect(reactionReportDecision({ currentStatus: "open", decision: "dismissed" }))
      .toEqual({ allowed: true, reason: "ok" })
    expect(reactionReportDecision({ currentStatus: "open", decision: "actioned" }))
      .toEqual({ allowed: true, reason: "ok" })
    // A replay after a decision is refused honestly, never re-decided.
    expect(reactionReportDecision({ currentStatus: "dismissed", decision: "actioned" }))
      .toEqual({ allowed: false, reason: "already_decided" })
    expect(reactionReportDecision({ currentStatus: "actioned", decision: "dismissed" }))
      .toEqual({ allowed: false, reason: "already_decided" })
    // No re-opening and no unknown decision shape survives the policy.
    expect(reactionReportDecision({ currentStatus: "open", decision: "reopen" as "actioned" }))
      .toEqual({ allowed: false, reason: "invalid_decision" })
    expect(reactionReportDecision({ currentStatus: "pending" as "open", decision: "actioned" }))
      .toEqual({ allowed: false, reason: "not_found" })
  })

  it("rate-limits report submissions at the reports floor", () => {
    expect(fanReportRateDecision(0)).toEqual({ allowed: true, reason: "ok" })
    expect(fanReportRateDecision(FAN_REPORT_MAX_PER_WINDOW - 1)).toEqual({ allowed: true, reason: "ok" })
    expect(fanReportRateDecision(FAN_REPORT_MAX_PER_WINDOW))
      .toEqual({ allowed: false, reason: "report_rate_limited" })
  })
})

describe("Fan interaction block policy (FAN-01 anti-abuse slice)", () => {
  it("exposes a fixed, labelled block reason set with no free text", () => {
    expect(FAN_BLOCK_REASONS).toEqual(["report_abuse", "reaction_abuse", "other"])
    for (const reason of FAN_BLOCK_REASONS) {
      expect(FAN_BLOCK_REASON_LABELS[reason].length).toBeGreaterThan(0)
    }
    expect(isFanBlockReason("reaction_abuse")).toBe(true)
    expect(isFanBlockReason("REACTION_ABUSE")).toBe(false) // case-pinned: no surprises at the DB CHECK.
    expect(isFanBlockReason("because")).toBe(false)
    expect(isFanBlockReason(undefined)).toBe(false)
  })

  it("lifts only active blocks; lifted is terminal with provenance required at the write tier", () => {
    expect(fanBlockLiftDecision({ currentStatus: "active" })).toEqual({ allowed: true, reason: "ok" })
    expect(fanBlockLiftDecision({ currentStatus: "lifted" }))
      .toEqual({ allowed: false, reason: "already_lifted" })
    expect(fanBlockLiftDecision({ currentStatus: "revoked" as "lifted" }))
      .toEqual({ allowed: false, reason: "not_found" })
  })

  it("refuses fail-closed only when an ACTIVE block exists - a lift restores participation", () => {
    expect(fanBlockEnforcement(true)).toEqual({ blocked: true })
    expect(fanBlockEnforcement(false)).toEqual({ blocked: false })
  })
})
