import { pgTable, uuid, text, timestamp, boolean, integer } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants } from "./tenants";
import { matches } from "./matches";

/**
 * Commentary events table - Ball-by-ball commentary text in multiple languages
 */
export const commentaryEvents = pgTable("commentary_events", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  matchId: uuid("match_id").notNull().references(() => matches.id, { onDelete: "cascade" }),
  overNumber: integer("over_number").notNull(),
  ballNumber: integer("ball_number").notNull(),
  language: text("language").notNull().default("en"),
  tone: text("tone").notNull().default("neutral"),
  text: text("text").notNull(),
  isAiGenerated: boolean("is_ai_generated").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type CommentaryEvent = typeof commentaryEvents.$inferSelect;
export type NewCommentaryEvent = typeof commentaryEvents.$inferInsert;
