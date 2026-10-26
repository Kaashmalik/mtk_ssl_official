import { randomUUID } from "crypto"
import {
  db,
  auditLogs,
  leagueChatSettings,
  matchChatMessages,
  matchChatMutes,
  matchChatReports,
  matches,
  tournaments,
  users,
} from "@mtk/database"
import {
  MATCH_CHAT_FLOOD_WINDOW_MS,
  chatPostingOpen,
  chatReadable,
  chatSendDecision,
  settledChatCursor,
} from "@mtk/database/lib/match-chat-policy"
import {
  MATCH_CHAT_DEFAULT_SLOW_MODE_SECONDS,
  MATCH_CHAT_PAGE_SIZE,
  isMatchChatMuteMinutes,
  isMatchChatReportReason,
  normalizeChatBody,
  normalizeSlowModeSeconds,
  type MatchChatMessage,
  type MatchChatPoll,
  type MatchChatSendResult,
} from "@mtk/contracts"
import { and, asc, count, desc, eq, gt, gte, inArray } from "drizzle-orm"
import { z } from "zod"
import { hasPermission } from "./rbac"
import { requireFanContext, type FanContext } from "./fan-follows"
import { readActiveFanBlockExists } from "./fan-block-records"
import { requireActiveLeagueContext } from "./league-reads"

/**
 * ENH-10 match chat (locked writer + reads). Transport: ADR 003.
 *
 * Identity, league and moderator authority are always derived server-side
 * from the session (`requireFanContext`): the match id from the client only
 * selects a room INSIDE the viewer's league, so a foreign match id reads as
 * missing. Chat is engagement only - nothing here touches scoring, and a chat
 * failure never affects the rest of the match page.
 */

const MODERATE_PERMISSION = "match:update" as const
const REMOVED_IDS_LIMIT = 200

const uuid = z.string().uuid()

export class MatchChatUnavailable extends Error {}

type ChatViewer = FanContext & { canModerate: boolean }

async function requireChatViewer(): Promise<ChatViewer> {
  const context = await requireFanContext("fan:read")
  return { ...context, canModerate: hasPermission(context.role, MODERATE_PERMISSION) }
}

/** The match's publication state inside the viewer's league; null when foreign or missing. */
async function readChatTarget(tenantId: string, matchId: string) {
  const [row] = await db
    .select({ status: matches.status, tournamentStatus: tournaments.status })
    .from(matches)
    .innerJoin(tournaments, and(eq(tournaments.id, matches.tournamentId), eq(tournaments.tenantId, tenantId)))
    .where(and(eq(matches.id, matchId), eq(matches.tenantId, tenantId)))
    .limit(1)
  if (!row) return null
  const input = { matchStatus: row.status, tournamentStatus: row.tournamentStatus }
  return { readable: chatReadable(input), postingOpen: chatPostingOpen(input) }
}

export async function readLeagueChatSettings(tenantId: string) {
  const [row] = await db
    .select({ enabled: leagueChatSettings.enabled, slowModeSeconds: leagueChatSettings.slowModeSeconds })
    .from(leagueChatSettings)
    .where(eq(leagueChatSettings.tenantId, tenantId))
    .limit(1)
  // No row means the owner never turned chat on: off by default.
  return {
    enabled: row?.enabled === true,
    slowModeSeconds: row ? normalizeSlowModeSeconds(row.slowModeSeconds) : MATCH_CHAT_DEFAULT_SLOW_MODE_SECONDS,
  }
}

async function readActiveMuteUntil(tenantId: string, userId: string, now: Date): Promise<Date | null> {
  const [row] = await db
    .select({ mutedUntil: matchChatMutes.mutedUntil })
    .from(matchChatMutes)
    .where(and(eq(matchChatMutes.tenantId, tenantId), eq(matchChatMutes.userId, userId), gt(matchChatMutes.mutedUntil, now)))
    .orderBy(desc(matchChatMutes.mutedUntil))
    .limit(1)
  return row?.mutedUntil ?? null
}

const messageColumns = {
  id: matchChatMessages.id,
  seq: matchChatMessages.seq,
  authorId: matchChatMessages.authorUserId,
  authorName: users.displayName,
  body: matchChatMessages.body,
  isModerator: matchChatMessages.isModerator,
  pinned: matchChatMessages.pinned,
  replyToId: matchChatMessages.replyToId,
  createdAt: matchChatMessages.createdAt,
}

type MessageRow = {
  id: string
  seq: number
  authorId: string
  authorName: string | null
  body: string
  isModerator: boolean
  pinned: boolean
  replyToId: string | null
  createdAt: Date
}

function toMessage(row: MessageRow): MatchChatMessage {
  return {
    id: row.id,
    seq: Number(row.seq),
    authorId: row.authorId,
    authorName: row.authorName?.trim() || "Fan",
    body: row.body,
    isModerator: row.isModerator,
    pinned: row.pinned,
    replyToId: row.replyToId,
    createdAt: row.createdAt.toISOString(),
  }
}

function visibleIn(tenantId: string, matchId: string) {
  return and(
    eq(matchChatMessages.tenantId, tenantId),
    eq(matchChatMessages.matchId, matchId),
    eq(matchChatMessages.status, "visible"),
  )
}

/**
 * One poll (ADR 003). `after` = 0 loads the latest page; otherwise everything
 * visible above the cursor. Throws MatchChatUnavailable for a missing,
 * foreign or unpublished match (the route answers 404).
 */
export async function pollMatchChat(input: { matchId: string; after: number; since: Date | null }): Promise<MatchChatPoll> {
  const matchId = uuid.parse(input.matchId)
  const viewer = await requireChatViewer()
  const target = await readChatTarget(viewer.tenantId, matchId)
  if (!target?.readable) throw new MatchChatUnavailable("Chat unavailable")

  const now = new Date()
  const settings = await readLeagueChatSettings(viewer.tenantId)
  const [mutedUntil, blocked] = await Promise.all([
    readActiveMuteUntil(viewer.tenantId, viewer.actorId, now),
    readActiveFanBlockExists(viewer.tenantId, viewer.actorId),
  ])
  const viewerState = {
    id: viewer.actorId,
    canModerate: viewer.canModerate,
    mutedUntil: mutedUntil?.toISOString() ?? null,
    blocked,
  }

  if (!settings.enabled) {
    return {
      enabled: false, postingOpen: false, slowModeSeconds: settings.slowModeSeconds,
      messages: [], removedIds: [], pinned: null, cursor: input.after,
      serverTime: now.toISOString(), viewer: viewerState,
    }
  }

  const after = Math.max(0, Math.trunc(input.after) || 0)
  const rows: MessageRow[] = after === 0
    ? (await db
        .select(messageColumns)
        .from(matchChatMessages)
        .innerJoin(users, eq(users.id, matchChatMessages.authorUserId))
        .where(visibleIn(viewer.tenantId, matchId))
        .orderBy(desc(matchChatMessages.seq))
        .limit(MATCH_CHAT_PAGE_SIZE)).reverse()
    : await db
        .select(messageColumns)
        .from(matchChatMessages)
        .innerJoin(users, eq(users.id, matchChatMessages.authorUserId))
        .where(and(visibleIn(viewer.tenantId, matchId), gt(matchChatMessages.seq, after)))
        .orderBy(asc(matchChatMessages.seq))
        .limit(MATCH_CHAT_PAGE_SIZE)

  const removed = input.since
    ? await db
        .select({ id: matchChatMessages.id })
        .from(matchChatMessages)
        .where(and(
          eq(matchChatMessages.tenantId, viewer.tenantId),
          eq(matchChatMessages.matchId, matchId),
          eq(matchChatMessages.status, "hidden"),
          gte(matchChatMessages.moderatedAt, input.since),
        ))
        .limit(REMOVED_IDS_LIMIT)
    : []

  const [pinnedRow] = await db
    .select(messageColumns)
    .from(matchChatMessages)
    .innerJoin(users, eq(users.id, matchChatMessages.authorUserId))
    .where(and(visibleIn(viewer.tenantId, matchId), eq(matchChatMessages.pinned, true)))
    .limit(1)

  return {
    enabled: true,
    postingOpen: target.postingOpen,
    slowModeSeconds: settings.slowModeSeconds,
    messages: rows.map(toMessage),
    removedIds: removed.map((row) => row.id),
    pinned: pinnedRow ? toMessage(pinnedRow) : null,
    cursor: settledChatCursor(rows.map((row) => ({ seq: Number(row.seq), createdAt: row.createdAt })), after, now),
    serverTime: now.toISOString(),
    viewer: viewerState,
  }
}

const sendSchema = z.object({
  matchId: uuid,
  body: z.unknown(),
  clientKey: uuid,
  replyToId: uuid.nullable().optional(),
  pin: z.boolean().optional(),
}).strict()

async function readMessageById(id: string): Promise<MatchChatMessage | null> {
  const [row] = await db
    .select(messageColumns)
    .from(matchChatMessages)
    .innerJoin(users, eq(users.id, matchChatMessages.authorUserId))
    .where(eq(matchChatMessages.id, id))
    .limit(1)
  return row ? toMessage(row) : null
}

export async function sendMatchChatMessage(input: unknown): Promise<MatchChatSendResult> {
  const parsed = sendSchema.safeParse(input)
  if (!parsed.success) return { ok: false, reason: "invalid", error: "That message could not be sent." }
  const { matchId, clientKey } = parsed.data
  const viewer = await requireChatViewer()

  const body = normalizeChatBody(parsed.data.body)
  if (!body.ok) return { ok: false, reason: "invalid", error: body.error }

  // A retried send after a lost response returns the original message.
  const [existing] = await db
    .select({ id: matchChatMessages.id })
    .from(matchChatMessages)
    .where(and(eq(matchChatMessages.authorUserId, viewer.actorId), eq(matchChatMessages.clientKey, clientKey)))
    .limit(1)
  if (existing) {
    const message = await readMessageById(existing.id)
    if (message) return { ok: true, message }
  }

  const target = await readChatTarget(viewer.tenantId, matchId)
  if (!target?.readable) return { ok: false, reason: "closed", error: "Chat is closed for this match." }

  const now = new Date()
  const settings = await readLeagueChatSettings(viewer.tenantId)
  const [blocked, mutedUntil, [last], [recent]] = await Promise.all([
    readActiveFanBlockExists(viewer.tenantId, viewer.actorId),
    readActiveMuteUntil(viewer.tenantId, viewer.actorId, now),
    db.select({ createdAt: matchChatMessages.createdAt })
      .from(matchChatMessages)
      .where(and(eq(matchChatMessages.tenantId, viewer.tenantId), eq(matchChatMessages.authorUserId, viewer.actorId)))
      .orderBy(desc(matchChatMessages.createdAt))
      .limit(1),
    db.select({ total: count() })
      .from(matchChatMessages)
      .where(and(
        eq(matchChatMessages.tenantId, viewer.tenantId),
        eq(matchChatMessages.authorUserId, viewer.actorId),
        gte(matchChatMessages.createdAt, new Date(now.getTime() - MATCH_CHAT_FLOOD_WINDOW_MS)),
      )),
  ])

  const decision = chatSendDecision({
    enabled: settings.enabled,
    postingOpen: target.postingOpen,
    blocked,
    mutedUntil,
    isModerator: viewer.canModerate,
    slowModeSeconds: settings.slowModeSeconds,
    lastMessageAt: last?.createdAt ?? null,
    messagesInFloodWindow: Number(recent?.total ?? 0),
    now,
  })
  if (!decision.ok) return decision

  // A reply must point at a visible message in the same room; anything else is dropped.
  let replyToId: string | null = null
  if (parsed.data.replyToId) {
    const [parent] = await db
      .select({ id: matchChatMessages.id })
      .from(matchChatMessages)
      .where(and(visibleIn(viewer.tenantId, matchId), eq(matchChatMessages.id, parsed.data.replyToId)))
      .limit(1)
    replyToId = parent?.id ?? null
  }
  const pin = parsed.data.pin === true && viewer.canModerate

  const inserted = await db.transaction(async (tx) => {
    if (pin) {
      await tx
        .update(matchChatMessages)
        .set({ pinned: false })
        .where(and(visibleIn(viewer.tenantId, matchId), eq(matchChatMessages.pinned, true)))
    }
    return tx
      .insert(matchChatMessages)
      .values({
        tenantId: viewer.tenantId,
        matchId,
        authorUserId: viewer.actorId,
        body: body.body,
        clientKey,
        replyToId,
        isModerator: viewer.canModerate,
        pinned: pin,
      })
      .onConflictDoNothing()
      .returning({ id: matchChatMessages.id })
  })

  const id = inserted[0]?.id ?? (await db
    .select({ id: matchChatMessages.id })
    .from(matchChatMessages)
    .where(and(eq(matchChatMessages.authorUserId, viewer.actorId), eq(matchChatMessages.clientKey, clientKey)))
    .limit(1))[0]?.id
  const message = id ? await readMessageById(id) : null
  if (!message) return { ok: false, reason: "invalid", error: "That message could not be sent." }
  return { ok: true, message }
}

async function auditChat(viewer: { tenantId: string; actorId: string; role: string }, method: string, payload: Record<string, unknown>) {
  await db.insert(auditLogs).values({
    requestId: randomUUID(),
    tenantId: viewer.tenantId,
    actorId: viewer.actorId,
    actorRole: viewer.role,
    method,
    path: "/matches/chat",
    statusCode: "200",
    payload,
  })
}

const moderateSchema = z.object({
  matchId: uuid,
  messageId: uuid,
  action: z.enum(["hide", "unpin"]),
}).strict()

/** Hide a message (or unpin an announcement). Moderators only; audited. */
export async function moderateChatMessage(input: unknown): Promise<{ ok: boolean }> {
  const { matchId, messageId, action } = moderateSchema.parse(input)
  const viewer = await requireActiveLeagueContext(MODERATE_PERMISSION)
  const now = new Date()
  const updated = await db
    .update(matchChatMessages)
    .set(action === "hide"
      ? { status: "hidden", pinned: false, moderatedBy: viewer.actorId, moderatedAt: now }
      : { pinned: false })
    .where(and(visibleIn(viewer.tenantId, matchId), eq(matchChatMessages.id, messageId)))
    .returning({ id: matchChatMessages.id, authorId: matchChatMessages.authorUserId })
  if (updated.length === 0) return { ok: false }
  if (action === "hide") {
    // Hiding settles every open report on that message.
    await db
      .update(matchChatReports)
      .set({ status: "resolved", resolvedBy: viewer.actorId, resolvedAt: now })
      .where(and(eq(matchChatReports.tenantId, viewer.tenantId), eq(matchChatReports.messageId, messageId), eq(matchChatReports.status, "open")))
  }
  await auditChat(viewer, action === "hide" ? "CHAT_MESSAGE_HIDDEN" : "CHAT_MESSAGE_UNPINNED", {
    matchId, messageId, authorId: updated[0].authorId,
  })
  return { ok: true }
}

const muteSchema = z.object({
  matchId: uuid,
  userId: uuid,
  minutes: z.number().int().refine(isMatchChatMuteMinutes, "Unsupported mute length"),
}).strict()

/** Timed league-wide chat mute. Moderators only; never on yourself; audited. */
export async function muteChatUser(input: unknown): Promise<{ ok: boolean; error?: string }> {
  const { matchId, userId, minutes } = muteSchema.parse(input)
  const viewer = await requireActiveLeagueContext(MODERATE_PERMISSION)
  if (userId === viewer.actorId) return { ok: false, error: "You can't mute yourself." }
  // The muted user must have written in this league's room - no muting strangers by id.
  const [authored] = await db
    .select({ id: matchChatMessages.id })
    .from(matchChatMessages)
    .where(and(eq(matchChatMessages.tenantId, viewer.tenantId), eq(matchChatMessages.matchId, matchId), eq(matchChatMessages.authorUserId, userId)))
    .limit(1)
  if (!authored) return { ok: false, error: "That person hasn't posted in this chat." }
  const now = new Date()
  await db.insert(matchChatMutes).values({
    tenantId: viewer.tenantId,
    userId,
    mutedBy: viewer.actorId,
    mutedUntil: new Date(now.getTime() + minutes * 60_000),
    createdAt: now,
  })
  await auditChat(viewer, "CHAT_USER_MUTED", { matchId, userId, minutes })
  return { ok: true }
}

const reportSchema = z.object({
  matchId: uuid,
  messageId: uuid,
  reason: z.string().refine(isMatchChatReportReason, "Unknown reason"),
}).strict()

/** A fan reports one visible message. Idempotent; never on your own message. */
export async function reportChatMessage(input: unknown): Promise<{ ok: boolean; error?: string }> {
  const parsed = reportSchema.parse(input)
  const viewer = await requireChatViewer()
  const [message] = await db
    .select({ id: matchChatMessages.id, authorId: matchChatMessages.authorUserId })
    .from(matchChatMessages)
    .where(and(visibleIn(viewer.tenantId, parsed.matchId), eq(matchChatMessages.id, parsed.messageId)))
    .limit(1)
  if (!message) return { ok: false, error: "That message is no longer available." }
  if (message.authorId === viewer.actorId) return { ok: false, error: "You can't report your own message." }
  await db.insert(matchChatReports).values({
    tenantId: viewer.tenantId,
    messageId: message.id,
    reporterUserId: viewer.actorId,
    reason: parsed.reason,
  }).onConflictDoNothing()
  return { ok: true }
}

export type OpenChatReport = {
  messageId: string
  matchId: string
  body: string
  authorId: string
  authorName: string
  reasons: string[]
  reportCount: number
  firstReportedAt: string
}

/** League moderation queue: open reports grouped by message, newest first. */
export async function readOpenChatReports(): Promise<OpenChatReport[]> {
  const viewer = await requireActiveLeagueContext(MODERATE_PERMISSION)
  const rows = await db
    .select({
      messageId: matchChatMessages.id,
      matchId: matchChatMessages.matchId,
      body: matchChatMessages.body,
      authorId: matchChatMessages.authorUserId,
      authorName: users.displayName,
      reason: matchChatReports.reason,
      createdAt: matchChatReports.createdAt,
    })
    .from(matchChatReports)
    .innerJoin(matchChatMessages, eq(matchChatMessages.id, matchChatReports.messageId))
    .innerJoin(users, eq(users.id, matchChatMessages.authorUserId))
    .where(and(eq(matchChatReports.tenantId, viewer.tenantId), eq(matchChatReports.status, "open"), eq(matchChatMessages.status, "visible")))
    .orderBy(desc(matchChatReports.createdAt))
    .limit(200)

  const grouped = new Map<string, OpenChatReport>()
  for (const row of rows) {
    const entry = grouped.get(row.messageId) ?? {
      messageId: row.messageId,
      matchId: row.matchId,
      body: row.body,
      authorId: row.authorId,
      authorName: row.authorName?.trim() || "Fan",
      reasons: [],
      reportCount: 0,
      firstReportedAt: row.createdAt.toISOString(),
    }
    entry.reportCount += 1
    if (!entry.reasons.includes(row.reason)) entry.reasons.push(row.reason)
    if (row.createdAt.toISOString() < entry.firstReportedAt) entry.firstReportedAt = row.createdAt.toISOString()
    grouped.set(row.messageId, entry)
  }
  return [...grouped.values()]
}

/** Dismiss every open report on a message without hiding it. Audited. */
export async function dismissChatReports(input: unknown): Promise<{ ok: boolean }> {
  const { messageIds } = z.object({ messageIds: z.array(uuid).min(1).max(50) }).strict().parse(input)
  const viewer = await requireActiveLeagueContext(MODERATE_PERMISSION)
  await db
    .update(matchChatReports)
    .set({ status: "resolved", resolvedBy: viewer.actorId, resolvedAt: new Date() })
    .where(and(eq(matchChatReports.tenantId, viewer.tenantId), inArray(matchChatReports.messageId, messageIds), eq(matchChatReports.status, "open")))
  await auditChat(viewer, "CHAT_REPORTS_DISMISSED", { messageIds })
  return { ok: true }
}

/** Owner settings read for the settings screen. */
export async function readMyLeagueChatSettings() {
  const viewer = await requireActiveLeagueContext("settings:manage")
  return readLeagueChatSettings(viewer.tenantId)
}

const settingsSchema = z.object({
  enabled: z.boolean(),
  slowModeSeconds: z.number().int(),
}).strict()

/** Turn chat on/off and set slow mode for the league. Owners only; audited. */
export async function updateLeagueChatSettings(input: unknown) {
  const parsed = settingsSchema.parse(input)
  const viewer = await requireActiveLeagueContext("settings:manage")
  const values = {
    enabled: parsed.enabled,
    slowModeSeconds: normalizeSlowModeSeconds(parsed.slowModeSeconds),
    updatedBy: viewer.actorId,
    updatedAt: new Date(),
  }
  await db
    .insert(leagueChatSettings)
    .values({ tenantId: viewer.tenantId, ...values })
    .onConflictDoUpdate({ target: leagueChatSettings.tenantId, set: values })
  await auditChat(viewer, "CHAT_SETTINGS_UPDATED", { enabled: values.enabled, slowModeSeconds: values.slowModeSeconds })
  return { enabled: values.enabled, slowModeSeconds: values.slowModeSeconds }
}

/**
 * Whether a league has chat turned on - a public fact used only to decide if
 * the chat panel renders at all. Fails closed: a read error hides the panel.
 */
export async function readPublicChatEnabled(tenantId: string): Promise<boolean> {
  try {
    return (await readLeagueChatSettings(uuid.parse(tenantId))).enabled
  } catch {
    return false
  }
}
