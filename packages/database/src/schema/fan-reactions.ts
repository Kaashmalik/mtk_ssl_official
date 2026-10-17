import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants } from "./tenants";
import { users } from "./users";
import { matches } from "./matches";

/**
 * Fan Reactions — moderated per-match fan reactions (FAN-01).
 *
 * Fans react to a published match from a FIXED, platform-chosen set (no free
 * text reaches the database, so nothing offensive can be stored). One active
 * reaction of each type per fan per match (unique index; toggling removes).
 * Reactions are engagement signals ONLY - they never feed scoring, standings
 * or awards, and no official decision can read them.
 */
export const fanReactions = pgTable(
  "fan_reactions",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    matchId: uuid("match_id").notNull().references(() => matches.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    // Constrained to the shared FAN_REACTION_TYPES set by a DB CHECK.
    reaction: text("reaction").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    uniqueFanReaction: sql`UNIQUE (${table.userId}, ${table.matchId}, ${table.reaction})`,
    matchIdx: index("fan_reactions_match_idx").on(table.matchId),
  }),
);

export type FanReaction = typeof fanReactions.$inferSelect;
export type NewFanReaction = typeof fanReactions.$inferInsert;
