import { pgTable, uuid, text, timestamp, integer, jsonb, boolean, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants } from "./tenants";
import { users } from "./users";

/**
 * In-app + delivery-channel notifications.
 *
 * Mirrors the live table created by the hand-written Supabase migrations:
 *   - `channel`  : push | email | sms | in_app
 *   - `status`   : pending | sent | delivered | failed | read
 * A row with channel = 'in_app' and read_at IS NULL is an unread bell item.
 */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v4()`),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id),
    type: text("type").notNull(),
    channel: text("channel").notNull().default("in_app"),
    title: text("title").notNull(),
    body: text("body").notNull(),
    data: jsonb("data").default({}),
    status: text("status").default("pending"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    readAt: timestamp("read_at", { withTimezone: true }),
    errorMessage: text("error_message"),
    retryCount: integer("retry_count").default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    userIdx: index("idx_notifications_user").on(table.userId, table.createdAt),
    tenantIdx: index("idx_notifications_tenant").on(table.tenantId),
    statusIdx: index("idx_notifications_status").on(table.status),
  }),
);

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;

/**
 * ENH-06-03: per-recipient read state for LEAGUE-WIDE notifications.
 *
 * A broadcast row (`notifications.user_id IS NULL`) is shared by every member of
 * the league, so `notifications.read_at` cannot express "member X read it":
 * writing it there would mark the broadcast read for everybody. This table
 * stores the read marker per (notification, member) pair instead; personal
 * rows keep their own `read_at` and never need a row here.
 *
 * The pair is unique, so a repeated "mark read" is an idempotent upsert.
 */
export const notificationReads = pgTable(
  "notification_reads",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v4()`),
    notificationId: uuid("notification_id")
      .notNull()
      .references(() => notifications.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    readAt: timestamp("read_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    memberUniq: uniqueIndex("notification_reads_notification_user_key").on(
      table.notificationId,
      table.userId,
    ),
    userIdx: index("idx_notification_reads_user").on(table.userId),
  }),
);

export type NotificationRead = typeof notificationReads.$inferSelect;
export type NewNotificationRead = typeof notificationReads.$inferInsert;

/**
 * Push notification device tokens (FCM / Expo).
 * user_id is NOT NULL — a token must always be attributable to a user.
 */
export const pushTokens = pgTable(
  "push_tokens",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v4()`),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    token: text("token").notNull(),
    platform: text("platform"),
    deviceId: text("device_id"),
    isActive: boolean("is_active").default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }).defaultNow(),
  },
  (table) => ({
    userTokenUniq: uniqueIndex("push_tokens_user_id_token_key").on(table.userId, table.token),
    userIdx: index("idx_push_tokens_user").on(table.userId),
  }),
);

export type PushToken = typeof pushTokens.$inferSelect;
export type NewPushToken = typeof pushTokens.$inferInsert;