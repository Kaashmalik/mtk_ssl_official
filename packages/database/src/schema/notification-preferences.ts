import { pgTable, uuid, boolean, smallint, timestamp, text } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants } from "./tenants";
import { users } from "./users";

/**
 * Notification Preferences — per-member, per-league consent + quiet hours.
 *
 * FAN-02: notifications are consent-gated and quiet-hours-aware. Every channel
 * a user may receive passes through the shared dispatch policy, which reads a
 * row from this table (one per league membership). Absence of a row means the
 * historical default: the in-app bell stays on, external channels stay off.
 *
 * Quiet hours are two wall-clock minute-of-day boundaries interpreted in the
 * member's own IANA time zone (stored alongside; null falls back to UTC).
 */
export const notificationPreferences = pgTable(
  "notification_preferences",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    // In-app bell consent; absent row defaults to true (see policy).
    inAppEnabled: boolean("in_app_enabled").default(true).notNull(),
    // FAN-02 email consent (B161). Fail-closed: absent/false. Delivery ALSO
    // requires the channel to be wired server-side; consent alone never sends.
    emailEnabled: boolean("email_enabled").default(false).notNull(),
    // Quiet window [start, end) in wall-clock minutes of day (0-1439).
    quietStartMinute: smallint("quiet_start_minute"),
    quietEndMinute: smallint("quiet_end_minute"),
    // IANA zone the quiet minutes are expressed in; null = UTC.
    timeZone: text("time_zone"),
    // Present (not absolute) creation timestamp, matching house style.
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    uniqueMember: sql`UNIQUE (${table.tenantId}, ${table.userId})`,
  }),
);

export type NotificationPreference = typeof notificationPreferences.$inferSelect;
export type NewNotificationPreference = typeof notificationPreferences.$inferInsert;
