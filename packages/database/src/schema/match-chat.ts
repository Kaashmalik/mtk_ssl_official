import { pgTable, uuid, text, timestamp, boolean, integer, bigint, index, uniqueIndex, check, foreignKey, type AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants } from "./tenants";
import { users } from "./users";
import { matches } from "./matches";

/**
 * ENH-10 moderated match chat. Transport, ordering and cursor rules:
 * docs/adr/003-match-chat-transport.md.
 *
 * Chat is OFF for a league until its owner enables it. Messages are plain
 * text, tenant-scoped through the match composite key, and hidden (never
 * edited or deleted) by moderators so moderation keeps its evidence. Chat is
 * engagement only - nothing official ever reads it.
 */
export const leagueChatSettings = pgTable(
  "league_chat_settings",
  {
    tenantId: uuid("tenant_id").primaryKey().references(() => tenants.id, { onDelete: "cascade" }),
    enabled: boolean("enabled").notNull().default(false),
    slowModeSeconds: integer("slow_mode_seconds").notNull().default(10),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    slowModeCheck: check("league_chat_settings_slow_mode_check", sql`${table.slowModeSeconds} IN (0, 5, 10, 30, 60)`),
  }),
);

export const matchChatMessages = pgTable(
  "match_chat_messages",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    seq: bigint("seq", { mode: "number" }).generatedAlwaysAsIdentity().notNull(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    matchId: uuid("match_id").notNull(),
    authorUserId: uuid("author_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    clientKey: uuid("client_key").notNull(),
    replyToId: uuid("reply_to_id").references((): AnyPgColumn => matchChatMessages.id, { onDelete: "set null" }),
    isModerator: boolean("is_moderator").notNull().default(false),
    pinned: boolean("pinned").notNull().default(false),
    status: text("status").$type<"visible" | "hidden">().notNull().default("visible"),
    moderatedBy: uuid("moderated_by").references(() => users.id, { onDelete: "set null" }),
    moderatedAt: timestamp("moderated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    matchFk: foreignKey({
      name: "match_chat_messages_match_fk",
      columns: [table.matchId, table.tenantId],
      foreignColumns: [matches.id, matches.tenantId],
    }).onDelete("cascade"),
    bodyCheck: check("match_chat_messages_body_check", sql`char_length(${table.body}) BETWEEN 1 AND 280`),
    statusCheck: check("match_chat_messages_status_check", sql`${table.status} IN ('visible', 'hidden')`),
    moderationCheck: check(
      "match_chat_messages_moderation_check",
      sql`${table.status} = 'visible' OR (${table.moderatedBy} IS NOT NULL AND ${table.moderatedAt} IS NOT NULL)`,
    ),
    pinCheck: check("match_chat_messages_pin_check", sql`NOT ${table.pinned} OR ${table.isModerator}`),
    seqKey: uniqueIndex("match_chat_messages_seq_key").on(table.seq),
    clientKey: uniqueIndex("match_chat_messages_client_key").on(table.authorUserId, table.clientKey),
    matchSeqIdx: index("idx_match_chat_messages_match_seq").on(table.matchId, table.seq),
    authorRecentIdx: index("idx_match_chat_messages_author_recent").on(table.tenantId, table.authorUserId, table.createdAt),
    pinnedKey: uniqueIndex("match_chat_messages_pinned_key")
      .on(table.matchId)
      .where(sql`${table.pinned} AND ${table.status} = 'visible'`),
  }),
);

export const matchChatMutes = pgTable(
  "match_chat_mutes",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    mutedUntil: timestamp("muted_until", { withTimezone: true }).notNull(),
    mutedBy: uuid("muted_by").notNull().references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    windowCheck: check("match_chat_mutes_window_check", sql`${table.mutedUntil} > ${table.createdAt}`),
    selfCheck: check("match_chat_mutes_self_check", sql`${table.userId} <> ${table.mutedBy}`),
    activeIdx: index("idx_match_chat_mutes_active").on(table.tenantId, table.userId, table.mutedUntil),
  }),
);

export const matchChatReports = pgTable(
  "match_chat_reports",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    messageId: uuid("message_id").notNull().references(() => matchChatMessages.id, { onDelete: "cascade" }),
    reporterUserId: uuid("reporter_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(),
    status: text("status").$type<"open" | "resolved">().notNull().default("open"),
    resolvedBy: uuid("resolved_by").references(() => users.id, { onDelete: "set null" }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    reasonCheck: check(
      "match_chat_reports_reason_check",
      sql`${table.reason} IN ('abusive', 'spam', 'inappropriate', 'other')`,
    ),
    statusCheck: check("match_chat_reports_status_check", sql`${table.status} IN ('open', 'resolved')`),
    resolutionCheck: check(
      "match_chat_reports_resolution_check",
      sql`${table.status} = 'open' OR (${table.resolvedBy} IS NOT NULL AND ${table.resolvedAt} IS NOT NULL)`,
    ),
    openKey: uniqueIndex("match_chat_reports_open_key")
      .on(table.messageId, table.reporterUserId)
      .where(sql`${table.status} = 'open'`),
    queueIdx: index("idx_match_chat_reports_queue").on(table.tenantId, table.status, table.createdAt),
  }),
);

export type LeagueChatSettings = typeof leagueChatSettings.$inferSelect;
export type MatchChatMessageRow = typeof matchChatMessages.$inferSelect;
export type MatchChatMute = typeof matchChatMutes.$inferSelect;
export type MatchChatReport = typeof matchChatReports.$inferSelect;
