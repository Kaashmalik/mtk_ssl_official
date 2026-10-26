/**
 * ENH-10 match chat policy (pure).
 *
 * The writer resolves identity, league membership and moderator authority
 * server-side and passes plain facts here; every decision is a value so the
 * rules are testable without a database. Chat is engagement only: no decision
 * here can affect scoring, standings or commentary.
 */
import { MATCH_CHAT_CURSOR_SETTLE_MS, type MatchChatSendRefusal } from "@mtk/contracts"
import { reactionTargetDecision } from "./fan-reaction-policy"

/** Flood floor on top of slow mode: at most this many messages per window. */
export const MATCH_CHAT_FLOOD_WINDOW_MS = 60_000
export const MATCH_CHAT_FLOOD_MAX = 10

/** Match states in which new messages are accepted (read stays open after). */
const POSTING_STATUSES = new Set(["scheduled", "toss", "live", "innings_break"])

/** Chat is readable on any published match - the same gate as fan reactions. */
export function chatReadable(input: { matchStatus: string; tournamentStatus: string }): boolean {
  return reactionTargetDecision(input).allowed
}

/** Posting is open only on a published match that has not finished. */
export function chatPostingOpen(input: { matchStatus: string; tournamentStatus: string }): boolean {
  return chatReadable(input) && POSTING_STATUSES.has(input.matchStatus)
}

export type ChatSendFacts = {
  enabled: boolean
  postingOpen: boolean
  blocked: boolean
  mutedUntil: Date | null
  isModerator: boolean
  slowModeSeconds: number
  lastMessageAt: Date | null
  messagesInFloodWindow: number
  now: Date
}

export type ChatSendDecision =
  | { ok: true }
  | { ok: false; reason: MatchChatSendRefusal; retryAfterSeconds?: number; error: string }

export function chatSendDecision(f: ChatSendFacts): ChatSendDecision {
  if (!f.enabled) return { ok: false, reason: "disabled", error: "Chat is turned off for this league." }
  if (!f.postingOpen) return { ok: false, reason: "closed", error: "Chat is closed for this match." }
  // Moderators keep their voice so they can calm a room down.
  if (f.isModerator) return { ok: true }
  if (f.blocked) return { ok: false, reason: "blocked", error: "You can't post in this league's chat." }
  if (f.mutedUntil && f.mutedUntil.getTime() > f.now.getTime()) {
    return {
      ok: false,
      reason: "muted",
      retryAfterSeconds: Math.ceil((f.mutedUntil.getTime() - f.now.getTime()) / 1000),
      error: "A moderator has paused your chat for a while.",
    }
  }
  if (f.slowModeSeconds > 0 && f.lastMessageAt) {
    const waitMs = f.lastMessageAt.getTime() + f.slowModeSeconds * 1000 - f.now.getTime()
    if (waitMs > 0) {
      const retryAfterSeconds = Math.ceil(waitMs / 1000)
      return { ok: false, reason: "slow_mode", retryAfterSeconds, error: `Slow mode is on. Wait ${retryAfterSeconds}s.` }
    }
  }
  if (f.messagesInFloodWindow >= MATCH_CHAT_FLOOD_MAX) {
    return { ok: false, reason: "rate_limited", retryAfterSeconds: 60, error: "You're sending messages too quickly." }
  }
  return { ok: true }
}

/**
 * The cursor to hand back after a poll (ADR 003). Identity values are
 * allocated before commit, so a lower `seq` can become visible after a higher
 * one. The cursor only moves past rows older than the settle window; newer
 * rows are delivered now AND again next poll, and the client de-duplicates.
 */
export function settledChatCursor(
  rows: readonly { seq: number; createdAt: Date }[],
  previousCursor: number,
  now: Date,
  settleMs: number = MATCH_CHAT_CURSOR_SETTLE_MS,
): number {
  const settledBefore = now.getTime() - settleMs
  let cursor = previousCursor
  for (const row of rows) {
    if (row.createdAt.getTime() > settledBefore) break
    if (row.seq > cursor) cursor = row.seq
  }
  return cursor
}

/**
 * Retention (ENH-10-01). Visible chat is short-lived engagement; hidden
 * messages are moderation evidence and are kept longer; lapsed mutes are
 * housekeeping. A message with an OPEN report is never purged - the writer
 * skips it until a moderator resolves the report.
 */
export const MATCH_CHAT_RETENTION_DAYS = { visible: 90, hidden: 365, expiredMutes: 30 } as const
/** Upper bound on rows removed per table per run, so one run stays short. */
export const MATCH_CHAT_RETENTION_BATCH = 500

const DAY_MS = 24 * 60 * 60 * 1000

export function chatRetentionCutoffs(now: Date) {
  return {
    visibleBefore: new Date(now.getTime() - MATCH_CHAT_RETENTION_DAYS.visible * DAY_MS),
    hiddenBefore: new Date(now.getTime() - MATCH_CHAT_RETENTION_DAYS.hidden * DAY_MS),
    mutesEndedBefore: new Date(now.getTime() - MATCH_CHAT_RETENTION_DAYS.expiredMutes * DAY_MS),
  }
}
