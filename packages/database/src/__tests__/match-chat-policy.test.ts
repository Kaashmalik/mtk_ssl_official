import { describe, expect, it } from "vitest"
import { getTableConfig } from "drizzle-orm/pg-core"
import { readFileSync } from "node:fs"
import { matchChatMessages, matchChatReports, leagueChatSettings } from "../schema/match-chat"
import {
  MATCH_CHAT_FLOOD_MAX,
  chatPostingOpen,
  chatReadable,
  chatSendDecision,
  settledChatCursor,
  type ChatSendFacts,
} from "../lib/match-chat-policy"

const migration = readFileSync(new URL("../../../../supabase/migrations/20261026130000_match_chat.sql", import.meta.url), "utf8")
  // Windows checkouts use CRLF; the pinned substrings are written with \n.
  .replace(/\r\n/g, "\n")

const NOW = new Date("2026-10-26T12:00:00Z")
const open: ChatSendFacts = {
  enabled: true,
  postingOpen: true,
  blocked: false,
  mutedUntil: null,
  isModerator: false,
  slowModeSeconds: 10,
  lastMessageAt: null,
  messagesInFloodWindow: 0,
  now: NOW,
}
const secondsAgo = (s: number) => new Date(NOW.getTime() - s * 1000)

describe("chat readability and posting window", () => {
  it("reads on any published match but posts only before the match finishes", () => {
    const published = { tournamentStatus: "live" }
    expect(chatReadable({ ...published, matchStatus: "completed" })).toBe(true)
    expect(chatPostingOpen({ ...published, matchStatus: "completed" })).toBe(false)
    for (const matchStatus of ["scheduled", "toss", "live", "innings_break"]) {
      expect(chatPostingOpen({ ...published, matchStatus }), matchStatus).toBe(true)
    }
  })

  it("is invisible on unpublished or cancelled matches", () => {
    expect(chatReadable({ tournamentStatus: "draft", matchStatus: "live" })).toBe(false)
    expect(chatReadable({ tournamentStatus: "live", matchStatus: "cancelled" })).toBe(false)
  })
})

describe("chatSendDecision", () => {
  it("accepts a fan in an open room", () => {
    expect(chatSendDecision(open)).toEqual({ ok: true })
  })

  it("refuses when the league has chat off or the match is closed - even for moderators", () => {
    expect(chatSendDecision({ ...open, enabled: false, isModerator: true })).toMatchObject({ ok: false, reason: "disabled" })
    expect(chatSendDecision({ ...open, postingOpen: false, isModerator: true })).toMatchObject({ ok: false, reason: "closed" })
  })

  it("refuses blocked fans and muted fans until the mute ends", () => {
    expect(chatSendDecision({ ...open, blocked: true })).toMatchObject({ ok: false, reason: "blocked" })
    expect(chatSendDecision({ ...open, mutedUntil: new Date(NOW.getTime() + 90_000) }))
      .toMatchObject({ ok: false, reason: "muted", retryAfterSeconds: 90 })
    expect(chatSendDecision({ ...open, mutedUntil: NOW })).toEqual({ ok: true })
  })

  it("enforces slow mode with an honest wait time", () => {
    expect(chatSendDecision({ ...open, lastMessageAt: secondsAgo(4) }))
      .toMatchObject({ ok: false, reason: "slow_mode", retryAfterSeconds: 6 })
    expect(chatSendDecision({ ...open, lastMessageAt: secondsAgo(10) })).toEqual({ ok: true })
    expect(chatSendDecision({ ...open, slowModeSeconds: 0, lastMessageAt: secondsAgo(0) })).toEqual({ ok: true })
  })

  it("applies the flood floor even with slow mode off", () => {
    expect(chatSendDecision({ ...open, slowModeSeconds: 0, messagesInFloodWindow: MATCH_CHAT_FLOOD_MAX }))
      .toMatchObject({ ok: false, reason: "rate_limited" })
  })

  it("lets moderators speak through slow mode, floods, mutes and blocks", () => {
    expect(chatSendDecision({
      ...open,
      isModerator: true,
      blocked: true,
      mutedUntil: new Date(NOW.getTime() + 60_000),
      lastMessageAt: secondsAgo(1),
      messagesInFloodWindow: 99,
    })).toEqual({ ok: true })
  })
})

describe("settledChatCursor (ADR 003)", () => {
  it("advances only past rows older than the settle window", () => {
    const rows = [
      { seq: 11, createdAt: secondsAgo(10) },
      { seq: 12, createdAt: secondsAgo(5) },
      { seq: 13, createdAt: secondsAgo(1) },
    ]
    expect(settledChatCursor(rows, 10, NOW, 3_000)).toBe(12)
  })

  it("never passes an unsettled row, even if later rows look settled", () => {
    const rows = [
      { seq: 21, createdAt: secondsAgo(1) },
      { seq: 22, createdAt: secondsAgo(20) },
    ]
    expect(settledChatCursor(rows, 20, NOW, 3_000)).toBe(20)
  })

  it("never moves backwards", () => {
    expect(settledChatCursor([], 50, NOW)).toBe(50)
  })
})

describe("match chat schema and migration contracts (not real SQL execution)", () => {
  it("ties every message to its league through the match composite key", () => {
    const fk = getTableConfig(matchChatMessages).foreignKeys.find(f => f.getName() === "match_chat_messages_match_fk")
    expect(fk?.reference().columns.map(c => c.name)).toEqual(["match_id", "tenant_id"])
    expect(migration).toContain("FOREIGN KEY (match_id, tenant_id) REFERENCES public.matches(id, tenant_id)")
  })

  it("makes retried sends idempotent and keeps one pinned announcement per match", () => {
    const indexes = getTableConfig(matchChatMessages).indexes.map(i => i.config.name)
    expect(indexes).toContain("match_chat_messages_client_key")
    expect(indexes).toContain("match_chat_messages_pinned_key")
    expect(migration).toContain("ON public.match_chat_messages (author_user_id, client_key)")
    expect(migration).toContain("WHERE pinned AND status = 'visible'")
  })

  it("starts with chat disabled and bounds content in the database too", () => {
    const enabled = getTableConfig(leagueChatSettings).columns.find(c => c.name === "enabled")
    expect(enabled?.default).toBe(false)
    expect(migration).toContain("enabled boolean NOT NULL DEFAULT false")
    expect(migration).toContain("CHECK (char_length(body) BETWEEN 1 AND 280)")
    expect(migration).toContain("CHECK (status = 'visible' OR (moderated_by IS NOT NULL AND moderated_at IS NOT NULL))")
  })

  it("keeps one open report per fan per message", () => {
    const openKey = getTableConfig(matchChatReports).indexes.find(i => i.config.name === "match_chat_reports_open_key")
    expect(openKey?.config.unique).toBe(true)
    expect(openKey?.config.where).toBeDefined()
  })

  it("is additive, idempotent, closed to PostgREST clients and never deletes evidence", () => {
    expect(migration).toContain("BEGIN;")
    expect(migration.trim()).toMatch(/COMMIT;$/)
    expect(migration).not.toMatch(/DROP TABLE|DELETE FROM|TRUNCATE/i)
    expect(migration.match(/CREATE TABLE IF NOT EXISTS/g)).toHaveLength(4)
    expect(migration.match(/FORCE ROW LEVEL SECURITY/g)).toHaveLength(4)
    expect(migration).not.toMatch(/GRANT[^;]*TO\s+(anon|authenticated)/i)
    expect(migration).not.toMatch(/GRANT[^;]*DELETE/i)
  })
})
