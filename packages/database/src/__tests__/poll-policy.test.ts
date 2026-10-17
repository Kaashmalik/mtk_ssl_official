import { describe, expect, it } from "vitest"
import {
  normalizePollOptions, normalizePollQuestion, pollVoteDecision,
  pollTransitionDecision, POLL_MAX_OPTIONS, POLL_MAX_QUESTION_LENGTH,
} from "../lib/poll-policy"

describe("Poll policy (FAN-01 moderated polls)", () => {
  it("normalizes 2-10 trimmed single-line options", () => {
    const result = normalizePollOptions(["  Who wins?  ", "Team A", "Team B"])
    expect(result).toEqual({ ok: true, options: ["Who wins?", "Team A", "Team B"] })
  })

  it("refuses wrong shapes, arities and option content", () => {
    expect(normalizePollOptions("nope")).toEqual({ ok: false, reason: "not_strings" })
    expect(normalizePollOptions([1, 2])).toEqual({ ok: false, reason: "not_strings" })
    expect(normalizePollOptions(["only one"])).toEqual({ ok: false, reason: "too_few" })
    expect(normalizePollOptions(Array.from({ length: POLL_MAX_OPTIONS + 1 }, (_, i) => `o${i}`)))
      .toEqual({ ok: false, reason: "too_many" })
    expect(normalizePollOptions(["a", "   "])).toEqual({ ok: false, reason: "empty_option" })
    expect(normalizePollOptions(["a", "x".repeat(121)])).toEqual({ ok: false, reason: "too_long" })
    expect(normalizePollOptions(["a", "two\nlines"])).toEqual({ ok: false, reason: "multiline" })
  })

  it("normalizes a bounded, single-line question", () => {
    expect(normalizePollQuestion("  Best team?  ")).toBe("Best team?")
    expect(normalizePollQuestion("")).toBeNull()
    expect(normalizePollQuestion("x".repeat(POLL_MAX_QUESTION_LENGTH + 1))).toBeNull()
    expect(normalizePollQuestion("two\nlines")).toBeNull()
    expect(normalizePollQuestion(42)).toBeNull()
  })

  it("admits a real option index on an open poll only (switching is allowed)", () => {
    const poll = { status: "open", optionsCount: 4 }
    expect(pollVoteDecision(poll, 0)).toEqual({ allowed: true, optionIndex: 0 })
    expect(pollVoteDecision(poll, 3)).toEqual({ allowed: true, optionIndex: 3 })
    expect(pollVoteDecision(poll, 4)).toEqual({ allowed: false, reason: "unknown_option" })
    expect(pollVoteDecision(poll, -1)).toEqual({ allowed: false, reason: "unknown_option" })
    expect(pollVoteDecision(poll, 1.5)).toEqual({ allowed: false, reason: "unknown_option" })
    expect(pollVoteDecision(poll, "1")).toEqual({ allowed: false, reason: "unknown_option" })
    expect(pollVoteDecision({ status: "draft", optionsCount: 4 }, 1))
      .toEqual({ allowed: false, reason: "not_open" })
    expect(pollVoteDecision({ status: "closed", optionsCount: 4 }, 1))
      .toEqual({ allowed: false, reason: "not_open" })
    expect(pollVoteDecision(null, 0)).toEqual({ allowed: false, reason: "not_a_poll" })
  })

  it("moves draft -> open -> closed and keeps closed terminal", () => {
    expect(pollTransitionDecision("draft", "open")).toEqual({ allowed: true, next: "open" })
    expect(pollTransitionDecision("open", "closed")).toEqual({ allowed: true, next: "closed" })
    // A draft can be withdrawn without ever opening.
    expect(pollTransitionDecision("draft", "closed")).toEqual({ allowed: true, next: "closed" })
    // Reopening is refused - votes would resume under different visibility.
    expect(pollTransitionDecision("closed", "open")).toEqual({ allowed: false, reason: "terminal_closed" })
    expect(pollTransitionDecision("open", "open")).toEqual({ allowed: false, reason: "unknown_transition" })
    expect(pollTransitionDecision("draft", "live")).toEqual({ allowed: false, reason: "unknown_transition" })
    expect(pollTransitionDecision("open", 42)).toEqual({ allowed: false, reason: "unknown_transition" })
  })
})
