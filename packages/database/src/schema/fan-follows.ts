import { pgTable, uuid, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants } from "./tenants";
import { users } from "./users";

/**
 * Followable entity type — what can fans follow
 */
export const followableTypeEnum = pgEnum("followable_type", ["team", "player", "tournament"]);

/**
 * Fan Follows — Users can follow teams, players, and tournaments.
 * Drives personalized feeds, notifications, and fan engagement metrics.
 */
export const fanFollows = pgTable("fan_follows", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  followableType: followableTypeEnum("followable_type").notNull(),
  followableId: uuid("followable_id").notNull(), // References team, player, or tournament ID
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  uniqueFollow: sql`UNIQUE (${table.userId}, ${table.followableType}, ${table.followableId})`,
}));

export type FanFollow = typeof fanFollows.$inferSelect;
export type NewFanFollow = typeof fanFollows.$inferInsert;
