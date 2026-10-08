import { pgTable, uuid, text, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants } from "./tenants";
import { players } from "./players";

/**
 * Player IDs — Unique league-issued identification numbers.
 * Format: {PREFIX}-{YEAR}-{SEQUENCE} e.g., SSL-2026-0042
 */
export const playerIds = pgTable("player_ids", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  playerId: uuid("player_id").notNull().references(() => players.id, { onDelete: "cascade" }),

  // ID Format
  prefix: text("prefix").notNull(),           // e.g., "SSL"
  year: integer("year").notNull(),             // e.g., 2026
  sequenceNumber: integer("sequence_number").notNull(), // e.g., 42
  formattedId: text("formatted_id").notNull(), // e.g., "SSL-2026-0042"

  // ID Card details
  issueDate: timestamp("issue_date", { withTimezone: true }).defaultNow().notNull(),
  expiryDate: timestamp("expiry_date", { withTimezone: true }),
  isValid: boolean("is_valid").default(true).notNull(),

  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  uniquePlayerTenant: sql`UNIQUE (${table.playerId}, ${table.tenantId})`,
  uniqueFormattedId: sql`UNIQUE (${table.formattedId})`,
}));

export type PlayerId = typeof playerIds.$inferSelect;
export type NewPlayerId = typeof playerIds.$inferInsert;
