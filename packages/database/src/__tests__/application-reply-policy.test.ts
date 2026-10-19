import { describe, expect, it } from "vitest"
import {
  describeReplyRefusal,
  normalizeReplyBody,
  REPLY_BODY_MAX,
  replyAuthorSide,
  replyThreadTarget,
} from "../lib/application-reply-policy"

const VIEWER = "00000000-0000-4000-8000-000000000001"
const MANAGER = "00000000-0000-4000-8000-000000000002"

describe("REG-03 (B164): reply body discipline", () => {
  it("trims and collapses whitespace, never truncates", () => {
    expect(normalizeReplyBody("  hello\n  world  ")).toEqual({ body: "hello world" })
  })

  it("refuses empty bodies explicitly and over-long bodies with a reason", () => {
    expect(normalizeReplyBody("   ")).toEqual({ refusal: "empty_body" })
    expect(normalizeReplyBody("x".repeat(REPLY_BODY_MAX + 1))).toEqual({ refusal: "body_too_long" })
    expect(normalizeReplyBody("x".repeat(REPLY_BODY_MAX))).toEqual({ body: "x".repeat(REPLY_BODY_MAX) })
  })

  it("every refusal names its member-facing sentence", () => {
    expect(describeReplyRefusal("empty_body")).toContain("Write a message")
    expect(describeReplyRefusal("body_too_long")).toContain("2000")
    expect(describeReplyRefusal("terminal")).toContain("locked")
    expect(describeReplyRefusal("forbidden")).toContain("manager or the league owner")
    expect(describeReplyRefusal("flood")).toContain("50")
  })
})

describe("REG-03 (B164): reply authority is derived, never client-asserted", () => {
  it("the current team manager speaks as member; the league owner as owner", () => {
    expect(replyAuthorSide({ userId: MANAGER }, { teamManagerId: MANAGER, tenantId: "t" }, null)).toBe("member")
    expect(
      replyAuthorSide({ userId: VIEWER }, { teamManagerId: MANAGER, tenantId: "t" }, { role: "league_owner", status: "active" }),
    ).toBe("owner")
  })

  it("everyone else is a refusal by construction", () => {
    expect(replyAuthorSide({ userId: VIEWER }, { teamManagerId: MANAGER, tenantId: "t" }, { role: "scorer", status: "active" })).toBeNull()
    expect(replyAuthorSide({ userId: VIEWER }, { teamManagerId: MANAGER, tenantId: "t" }, { role: "league_owner", status: "suspended" })).toBeNull()
    expect(replyAuthorSide({ userId: VIEWER }, { teamManagerId: MANAGER, tenantId: "t" }, null)).toBeNull()
  })

  it("an expired/suspended manager does not speak through stale authority (side comes from CURRENT facts)", () => {
    // The side derivation uses the CURRENT team manager row; a former
    // manager's user id no longer matches, so the writer's membership /
    // manager check is what keeps them out - asserted through the null here.
    expect(replyAuthorSide({ userId: VIEWER }, { teamManagerId: MANAGER, tenantId: "t" }, { role: "captain", status: "active" })).toBeNull()
  })
})

describe("REG-03 (B164): threads live only on live applications", () => {
  it("live states accept replies; terminal states are locked history", () => {
    for (const status of ["submitted", "needs_information", "waitlisted"]) {
      expect(replyThreadTarget(status)).toBe("open")
    }
    for (const status of ["approved", "declined", "withdrawn"]) {
      expect(replyThreadTarget(status)).toBe("terminal")
    }
  })
})
