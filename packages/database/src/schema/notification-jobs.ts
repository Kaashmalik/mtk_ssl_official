import { pgTable, uuid, text, integer, timestamp, jsonb, index, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants } from "./tenants";
import { users } from "./users";

/**
 * ENH-06-04: the durable notification outbox.
 *
 * Provider HTTP must never be the only record of "this notice was owed". A
 * producer writes a job in the SAME transaction as the fact that caused it
 * (account creation, a lifecycle event, a fan-out), and a bounded worker
 * leases due rows, delivers them, and settles the state honestly:
 *
 *   pending -> leased -> provider_accepted | cancelled | dead_lettered
 *
 * `tenant_id` is NULL for account-level mail (onboarding) that must not
 * require a league membership. `unique(event_id, recipient_user_id, channel)`
 * makes a producer retry (webhook redelivery, request replay) idempotent per
 * event/recipient/channel; the worker additionally fences every settlement on
 * its lease token, so two replicas cannot both settle the same job.
 */
export const notificationJobs = pgTable(
  "notification_jobs",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v4()`),
    /** NULL = account-level (no league membership required). */
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
    recipientUserId: uuid("recipient_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    eventId: text("event_id").notNull(),
    channel: text("channel").notNull(),
    type: text("type").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    data: jsonb("data").default({}),
    state: text("state").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    leaseToken: uuid("lease_token"),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => ({
    eventRecipientChannelUniq: uniqueIndex("notification_jobs_event_recipient_channel_key").on(
      table.eventId,
      table.recipientUserId,
      table.channel,
    ),
    dueIdx: index("notification_jobs_due_idx")
      .on(table.nextAttemptAt, table.id)
      .where(sql`${table.state} IN ('pending','leased')`),
    recipientIdx: index("notification_jobs_recipient_idx").on(
      table.recipientUserId,
      table.createdAt,
    ),
    channelCheck: check(
      "notification_jobs_channel_check",
      sql`${table.channel} IN ('in_app','email','push')`,
    ),
    stateCheck: check(
      "notification_jobs_state_check",
      sql`${table.state} IN ('pending','leased','provider_accepted','cancelled','dead_lettered')`,
    ),
    attemptsCheck: check("notification_jobs_attempts_check", sql`${table.attempts} >= 0`),
  }),
);

export type NotificationJob = typeof notificationJobs.$inferSelect;
export type NewNotificationJob = typeof notificationJobs.$inferInsert;
