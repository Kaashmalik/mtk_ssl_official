/**
 * ENH-10-02: match chat contract shared by web, the mobile BFF and native.
 *
 * Pure: no DOM, no storage, no environment. Transport and storage decisions
 * live in docs/adr/003-match-chat-transport.md.
 *
 * Content rules are deliberately strict for a first release:
 * - plain text only, rendered as text (never HTML);
 * - no links or domain-like text (the cheapest abuse/phishing vector);
 * - control and zero-width characters are stripped, whitespace collapsed;
 * - bounded length.
 */

export const MATCH_CHAT_MAX_LENGTH = 280
/** Upper bound for one page of history or one poll. */
export const MATCH_CHAT_PAGE_SIZE = 50
/** Client poll interval while the chat panel is visible. */
export const MATCH_CHAT_POLL_MS = 4_000
/** The cursor only advances past messages at least this old (ADR 003). */
export const MATCH_CHAT_CURSOR_SETTLE_MS = 3_000
/** Slow-mode choices a league owner can pick (seconds between messages). */
export const MATCH_CHAT_SLOW_MODE_OPTIONS = [0, 5, 10, 30, 60] as const
export const MATCH_CHAT_DEFAULT_SLOW_MODE_SECONDS = 10
/** Mute (timeout) lengths a moderator can pick, in minutes. */
export const MATCH_CHAT_MUTE_MINUTES = [5, 30, 120, 1440] as const

export const MATCH_CHAT_REPORT_REASONS = ["abusive", "spam", "inappropriate", "other"] as const
export type MatchChatReportReason = (typeof MATCH_CHAT_REPORT_REASONS)[number]

export function isMatchChatReportReason(value: unknown): value is MatchChatReportReason {
  return typeof value === "string" && (MATCH_CHAT_REPORT_REASONS as readonly string[]).includes(value)
}

export type MatchChatMessage = {
  id: string
  /** Server sequence; strictly increasing per insert, used for ordering. */
  seq: number
  authorId: string
  authorName: string
  body: string
  /** Set when the author is a league moderator posting as staff. */
  isModerator: boolean
  pinned: boolean
  replyToId: string | null
  createdAt: string
}

export type MatchChatPoll = {
  enabled: boolean
  /** Whether new messages are accepted right now (match state + settings). */
  postingOpen: boolean
  slowModeSeconds: number
  messages: MatchChatMessage[]
  /** Ids hidden by moderators since the client's `since` timestamp. */
  removedIds: string[]
  pinned: MatchChatMessage | null
  /** Pass back as `after` on the next poll. */
  cursor: number
  /** Server time of this read; pass back as `since` on the next poll. */
  serverTime: string
  viewer: {
    /** The viewer's own user id, so the UI can tell their messages apart. */
    id: string
    canModerate: boolean
    /** ISO time the viewer's mute ends, or null. */
    mutedUntil: string | null
    blocked: boolean
  }
}

export type MatchChatSendRefusal =
  | "disabled"
  | "closed"
  | "blocked"
  | "muted"
  | "slow_mode"
  | "rate_limited"
  | "invalid"

export type MatchChatSendResult =
  | { ok: true; message: MatchChatMessage }
  | { ok: false; reason: MatchChatSendRefusal; retryAfterSeconds?: number; error: string }

// Control characters (except newline/tab, which are collapsed below), zero
// width / bidi override characters that can disguise text.
// eslint-disable-next-line no-control-regex
const INVISIBLE = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F​-‏‪-‮⁠-⁤﻿]/g
// Scheme links, www. hosts and bare domains with a common TLD shape.
const LINK = /(?:[a-z][a-z0-9+.-]*:\/\/)|(?:\bwww\.)|(?:\b[a-z0-9-]{2,}\.(?:com|net|org|io|co|me|ly|gg|tv|xyz|info|biz|app|link|site|online|pk|in|uk|bd|ae)\b)/i

export type ChatBodyResult =
  | { ok: true; body: string }
  | { ok: false; error: string }

/** Normalise and validate a chat message body. Never throws. */
export function normalizeChatBody(input: unknown): ChatBodyResult {
  if (typeof input !== "string") return { ok: false, error: "Write a message first." }
  const body = input.normalize("NFC").replace(INVISIBLE, "").replace(/\s+/g, " ").trim()
  if (body.length === 0) return { ok: false, error: "Write a message first." }
  if (body.length > MATCH_CHAT_MAX_LENGTH) {
    return { ok: false, error: `Keep it under ${MATCH_CHAT_MAX_LENGTH} characters.` }
  }
  if (LINK.test(body)) return { ok: false, error: "Links are not allowed in match chat." }
  return { ok: true, body }
}

/** Clamp a stored or requested slow-mode value onto the allowed options. */
export function normalizeSlowModeSeconds(value: unknown): number {
  // Number(null) and Number("") are 0, which would silently turn slow mode off.
  const n = typeof value === "number" ? value
    : typeof value === "string" && value.trim() !== "" ? Number(value)
    : Number.NaN
  return (MATCH_CHAT_SLOW_MODE_OPTIONS as readonly number[]).includes(n)
    ? n
    : MATCH_CHAT_DEFAULT_SLOW_MODE_SECONDS
}

export function isMatchChatMuteMinutes(value: unknown): value is (typeof MATCH_CHAT_MUTE_MINUTES)[number] {
  return typeof value === "number" && (MATCH_CHAT_MUTE_MINUTES as readonly number[]).includes(value)
}
