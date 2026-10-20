import { describe, expect, it } from "vitest"
import {
  describeLeagueReplyRefusal,
  leagueApplicationReplyTarget,
  LEAGUE_REPLY_BODY_MAX,
  normalizeLeagueReplyBody,
} from "../lib/league-application-policy"

/**
 * ENH-02-02: persisted applicant replies under a league application's
 * information request. Deliberately NOT the tournament reply policy (REG-03):
 * league onboarding is platform-level, the only author side is the applicant,
 * and the thread opens ONLY while a reviewer has explicitly requested
 * information (`needs_information`).
 */

describe("ENH-02-02: league reply body discipline", () => {
  it("trims and collapses whitespace, never truncates", () => {
    expect(normalizeLeagueReplyBody("  hello\n  world  ")).toEqual({ body: "hello world" })
  })

  it("refuses empty bodies explicitly and over-long bodies with a reason", () => {
    expect(normalizeLeagueReplyBody("   ")).toEqual({ refusal: "empty_body" })
    expect(normalizeLeagueReplyBody("x".repeat(LEAGUE_REPLY_BODY_MAX + 1))).toEqual({ refusal: "body_too_long" })
    expect(normalizeLeagueReplyBody("x".repeat(LEAGUE_REPLY_BODY_MAX))).toEqual({
      body: "x".repeat(LEAGUE_REPLY_BODY_MAX),
    })
  })

  it("every refusal names its member-facing sentence", () => {
    expect(describeLeagueReplyRefusal("empty_body")).toContain("Write a message")
    expect(describeLeagueReplyRefusal("body_too_long")).toContain("2000")
    expect(describeLeagueReplyRefusal("terminal")).toContain("read only")
    expect(describeLeagueReplyRefusal("not_requested")).toContain("requested information")
  })
})

describe("ENH-02-02: the thread opens only for an information request", () => {
  it("needs_information accepts applicant replies; draft and submitted do not", () => {
    expect(leagueApplicationReplyTarget("needs_information")).toBe("open")
    expect(leagueApplicationReplyTarget("draft")).toBe("not_requested")
    expect(leagueApplicationReplyTarget("submitted")).toBe("not_requested")
  })

  it("terminal states are locked history and unknown states never open", () => {
    for (const state of ["approved", "rejected", "withdrawn"] as const) {
      expect(leagueApplicationReplyTarget(state)).toBe("terminal")
    }
    expect(leagueApplicationReplyTarget("mystery")).toBe("not_requested")
  })
})
