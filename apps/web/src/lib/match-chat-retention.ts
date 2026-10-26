import { db, matchChatMessages, matchChatMutes, matchChatReports } from "@mtk/database"
import {
  MATCH_CHAT_RETENTION_BATCH,
  chatRetentionCutoffs,
} from "@mtk/database/lib/match-chat-policy"
import { and, asc, eq, inArray, lt, notExists, or } from "drizzle-orm"

/**
 * ENH-10-01 chat retention worker (run by /api/cron/chat-retention).
 *
 * Off unless MATCH_CHAT_RETENTION_READY=1: deletion is irreversible, so it is
 * an explicit owner decision, like the other provider/cleanup gates. Each run
 * removes at most one bounded batch per table, oldest first. Messages with an
 * OPEN report are skipped until a moderator resolves the report, so a purge
 * can never destroy the evidence a pending review depends on.
 */

export function chatRetentionReady(): boolean {
  return process.env.MATCH_CHAT_RETENTION_READY === "1"
}

export type ChatRetentionResult =
  | { ran: false; reason: "gate_off" }
  | { ran: true; messagesDeleted: number; mutesDeleted: number; batchLimit: number }

export async function purgeExpiredChat(now: Date = new Date()): Promise<ChatRetentionResult> {
  if (!chatRetentionReady()) return { ran: false, reason: "gate_off" }
  const cutoffs = chatRetentionCutoffs(now)

  const expired = await db
    .select({ id: matchChatMessages.id })
    .from(matchChatMessages)
    .where(and(
      or(
        and(eq(matchChatMessages.status, "visible"), lt(matchChatMessages.createdAt, cutoffs.visibleBefore)),
        and(eq(matchChatMessages.status, "hidden"), lt(matchChatMessages.createdAt, cutoffs.hiddenBefore)),
      ),
      notExists(
        db.select({ id: matchChatReports.id })
          .from(matchChatReports)
          .where(and(eq(matchChatReports.messageId, matchChatMessages.id), eq(matchChatReports.status, "open"))),
      ),
    ))
    .orderBy(asc(matchChatMessages.createdAt))
    .limit(MATCH_CHAT_RETENTION_BATCH)

  const messagesDeleted = expired.length === 0 ? 0 : (await db
    .delete(matchChatMessages)
    .where(inArray(matchChatMessages.id, expired.map((row) => row.id)))
    .returning({ id: matchChatMessages.id })).length

  const lapsed = await db
    .select({ id: matchChatMutes.id })
    .from(matchChatMutes)
    .where(lt(matchChatMutes.mutedUntil, cutoffs.mutesEndedBefore))
    .orderBy(asc(matchChatMutes.mutedUntil))
    .limit(MATCH_CHAT_RETENTION_BATCH)

  const mutesDeleted = lapsed.length === 0 ? 0 : (await db
    .delete(matchChatMutes)
    .where(inArray(matchChatMutes.id, lapsed.map((row) => row.id)))
    .returning({ id: matchChatMutes.id })).length

  return { ran: true, messagesDeleted, mutesDeleted, batchLimit: MATCH_CHAT_RETENTION_BATCH }
}
