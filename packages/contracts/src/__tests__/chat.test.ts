import { describe, expect, it } from "vitest"
import {
  MATCH_CHAT_DEFAULT_SLOW_MODE_SECONDS,
  MATCH_CHAT_MAX_LENGTH,
  isMatchChatMuteMinutes,
  mergeChatMessages,
  isMatchChatReportReason,
  normalizeChatBody,
  normalizeSlowModeSeconds,
} from "../chat"

/**
 * ENH-10-02: chat content rules. Plain text only, no links, no invisible or
 * direction-override characters, bounded length.
 */

describe("normalizeChatBody", () => {
  it("collapses whitespace and trims", () => {
    expect(normalizeChatBody("  what   a\n\tshot!  ")).toEqual({ ok: true, body: "what a shot!" })
  })

  it("keeps emoji and non-Latin text", () => {
    expect(normalizeChatBody("شاندار 🏏🔥")).toEqual({ ok: true, body: "شاندار 🏏🔥" })
  })

  it("strips zero-width and bidi-override characters that disguise text", () => {
    expect(normalizeChatBody("go​‮od")).toEqual({ ok: true, body: "good" })
  })

  it("refuses empty, non-string and over-length input", () => {
    expect(normalizeChatBody("   ").ok).toBe(false)
    expect(normalizeChatBody("​").ok).toBe(false)
    expect(normalizeChatBody(42).ok).toBe(false)
    expect(normalizeChatBody(undefined).ok).toBe(false)
    expect(normalizeChatBody("x".repeat(MATCH_CHAT_MAX_LENGTH)).ok).toBe(true)
    expect(normalizeChatBody("x".repeat(MATCH_CHAT_MAX_LENGTH + 1)).ok).toBe(false)
  })

  it("refuses links and domain-like text", () => {
    for (const text of [
      "see https://evil.example",
      "HTTP://x.y",
      "join www.free-tickets.biz now",
      "free stream at cricketfree.tv",
      "javascript://alert(1)",
      "visit scam.com",
    ]) {
      expect(normalizeChatBody(text), text).toMatchObject({ ok: false })
    }
  })

  it("does not mistake ordinary cricket talk for links", () => {
    for (const text of ["4.2 overs left", "Rahman 48 off 31", "Mr. Khan bowled well", "e.g. a yorker"]) {
      expect(normalizeChatBody(text), text).toMatchObject({ ok: true })
    }
  })
})

describe("chat option guards", () => {
  it("clamps slow mode to the allowed options", () => {
    expect(normalizeSlowModeSeconds(30)).toBe(30)
    expect(normalizeSlowModeSeconds("0")).toBe(0)
    expect(normalizeSlowModeSeconds(7)).toBe(MATCH_CHAT_DEFAULT_SLOW_MODE_SECONDS)
    expect(normalizeSlowModeSeconds(null)).toBe(MATCH_CHAT_DEFAULT_SLOW_MODE_SECONDS)
  })

  it("accepts only the fixed report reasons and mute lengths", () => {
    expect(isMatchChatReportReason("spam")).toBe(true)
    expect(isMatchChatReportReason("free text")).toBe(false)
    expect(isMatchChatMuteMinutes(30)).toBe(true)
    expect(isMatchChatMuteMinutes(31)).toBe(false)
    expect(isMatchChatMuteMinutes("30")).toBe(false)
  })
})

describe("mergeChatMessages (shared by web and native)", () => {
  const msg = (seq: number, id = `m${seq}`) => ({
    id, seq, authorId: "u", authorName: "Fan", body: `b${seq}`,
    isModerator: false, pinned: false, replyToId: null, createdAt: "2026-10-26T12:00:00.000Z",
  })

  it("orders by server sequence and counts only unseen messages", () => {
    const { messages, added } = mergeChatMessages([msg(2)], [msg(3), msg(1)])
    expect(messages.map((m) => m.seq)).toEqual([1, 2, 3])
    expect(added).toBe(2)
  })

  it("treats settle-window re-deliveries as duplicates, never new", () => {
    const first = mergeChatMessages([], [msg(1), msg(2)])
    const again = mergeChatMessages(first.messages, [msg(2), msg(3)])
    expect(again.messages.map((m) => m.seq)).toEqual([1, 2, 3])
    expect(again.added).toBe(1)
  })

  it("drops moderator-removed messages, even ones arriving in the same poll", () => {
    const { messages, added } = mergeChatMessages([msg(1), msg(2)], [msg(3)], ["m2", "m3"])
    expect(messages.map((m) => m.id)).toEqual(["m1"])
    expect(added).toBe(0)
  })

  it("keeps only the newest messages past the cap", () => {
    const many = Array.from({ length: 5 }, (_, i) => msg(i + 1))
    expect(mergeChatMessages([], many, [], 3).messages.map((m) => m.seq)).toEqual([3, 4, 5])
  })

  it("does not mutate its inputs", () => {
    const current = Object.freeze([msg(1)])
    expect(() => mergeChatMessages(current, [msg(2)])).not.toThrow()
    expect(current).toHaveLength(1)
  })
})
