import { pgTable, uuid, text, timestamp, integer, bigserial, jsonb, foreignKey, uniqueIndex, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { matches } from "./matches";

/** Internal delivery journal. No anonymous/member access, and no automatic expiry. */
export const scoringOutbox = pgTable("scoring_outbox", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  matchId: uuid("match_id").notNull(),
  topic: text("topic").notNull(),
  eventId: text("event_id").notNull(),
  payload: jsonb("payload").notNull(),
  attempts: integer("attempts").notNull().default(0),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  foreignKey({ name: "scoring_outbox_match_tenant_fk", columns: [table.matchId, table.tenantId], foreignColumns: [matches.id, matches.tenantId] }).onDelete("restrict"),
  uniqueIndex("scoring_outbox_event_key").on(table.topic, table.eventId),
  index("scoring_outbox_pending_idx").on(table.id).where(sql`${table.deliveredAt} IS NULL`),
  index("scoring_outbox_match_pending_idx").on(table.tenantId, table.matchId, table.id).where(sql`${table.deliveredAt} IS NULL`),
  check("scoring_outbox_attempts_check", sql`${table.attempts} >= 0`),
  check("scoring_outbox_topic_check", sql`${table.topic} IN ('ssl.scoring.ball-events', 'ssl.match.events')`),
  check("scoring_outbox_envelope_check", sql`jsonb_typeof(${table.payload}) = 'object'
    AND (${table.payload}->>'tenantId') IS NOT NULL AND (${table.payload}->>'tenantId') = ${table.tenantId}::text
    AND (${table.payload}->>'matchId') IS NOT NULL AND (${table.payload}->>'matchId') = ${table.matchId}::text
    AND (${table.payload}->>'eventId') IS NOT NULL AND (${table.payload}->>'eventId') = ${table.eventId}`),
]);
export type ScoringOutboxRow = typeof scoringOutbox.$inferSelect;
