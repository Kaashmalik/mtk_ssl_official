import { pgTable, uuid, integer, timestamp, pgEnum, jsonb, bigint, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants } from "./tenants";
import { matches } from "./matches";

/**
 * Event type enum for scoring CQRS
 */
export const eventTypeEnum = pgEnum("event_type", [
  "ball_recorded",
  "ball_undone",
  "innings_started",
  "innings_completed",
  "match_started",
  "match_completed",
  "player_substituted",
  "penalty_awarded",
]);

/**
 * Scoring events table — Immutable ball-by-ball event store log
 */
export const scoringEvents = pgTable("scoring_events", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  matchId: uuid("match_id").notNull().references(() => matches.id, { onDelete: "cascade" }),
  inningsId: uuid("innings_id"),
  eventType: eventTypeEnum("event_type").notNull(),
  eventVersion: integer("event_version").notNull().default(1),
  aggregateId: uuid("aggregate_id").notNull(),
  sequenceNumber: bigint("sequence_number", { mode: "number" }).notNull(),
  payload: jsonb("payload").notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  // Append-only safety: two concurrent transactions must never mint the same
  // sequence number for the same aggregate (scoring.service.ts mints MAX(seq)+1
  // without a locked counter, so this constraint is the backstop).
  uniqueIndex("uqx_scoring_events_aggregate_sequence").on(
    table.aggregateId,
    table.sequenceNumber
  ),
]);

export type ScoringEvent = typeof scoringEvents.$inferSelect;
export type NewScoringEvent = typeof scoringEvents.$inferInsert;
