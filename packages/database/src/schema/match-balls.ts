import {
  pgTable,
  uuid,
  integer,
  timestamp,
  boolean,
  text,
  pgEnum,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants } from "./tenants";
import { matches } from "./matches";
import { matchInnings } from "./match-innings";
import { players } from "./players";


/**
 * Wicket type enum
 */
export const wicketTypeEnum = pgEnum("wicket_type", [
  "bowled",
  "caught",
  "lbw",
  "run_out",
  "stumped",
  "hit_wicket",
  "retired",
  "retired_hurt",
]);

/**
 * Match balls table - Ball-by-ball data
 */
export const matchBalls = pgTable("match_balls", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  matchId: uuid("match_id").notNull().references(() => matches.id, { onDelete: "cascade" }),
  inningsId: uuid("innings_id").notNull().references(() => matchInnings.id, { onDelete: "cascade" }),
  /** Monotonic per-(match, innings) delivery ordinal. Server-assigned,
   *  independent of the display coordinates (over_number, ball_number) so
   *  wide/no-ball extras can never collide with the next legal delivery.
   *  Created by migration 023; the default is a transition safety net only. */
  ballSequence: integer("ball_sequence").notNull().default(sql`nextval('match_balls_ball_sequence_seq')`),
  /** Client-supplied op id. The partial unique index on (match_id,
   *  client_op_id) is the idempotent-replay enforcement point. */
  clientOpId: text("client_op_id"),
  overNumber: integer("over_number").notNull(),
  ballNumber: integer("ball_number").notNull(), // 1-6
  bowlerId: uuid("bowler_id").references(() => players.id, { onDelete: "set null" }),
  batsmanId: uuid("batsman_id").references(() => players.id, { onDelete: "set null" }),
  runs: integer("runs").default(0).notNull(),
  isWicket: boolean("is_wicket").default(false).notNull(),
  wicketType: wicketTypeEnum("wicket_type"),
  isFour: boolean("is_four").default(false).notNull(),
  isSix: boolean("is_six").default(false).notNull(),
  isWide: boolean("is_wide").default(false).notNull(),
  isNoBall: boolean("is_no_ball").default(false).notNull(),
  isBye: boolean("is_bye").default(false).notNull(),
  isLegBye: boolean("is_leg_bye").default(false).notNull(),
  shotDirection: text("shot_direction"), // For wagon wheel
  shotType: text("shot_type"), // e.g., 'drive', 'cut', 'pull'
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  // Uniqueness: per-innings sequence, NOT display coordinates.
  inningsSequenceIdx: uniqueIndex("uqx_match_balls_innings_sequence").on(
    table.matchId,
    table.inningsId,
    table.ballSequence,
  ),
  // Idempotency enforcement for offline replay (partial unique index).
  clientOpIdx: uniqueIndex("uqx_match_balls_client_op")
    .on(table.matchId, table.clientOpId)
    .where(sql`${table.clientOpId} is not null`),
  bowlerIdIdx: index("idx_match_balls_bowler_id").on(table.bowlerId),
  batsmanIdIdx: index("idx_match_balls_batsman_id").on(table.batsmanId),
  matchOverIdx: index("idx_match_balls_match_over").on(table.matchId, table.overNumber),
  // Read-path: coordinates stay indexable (matches 002's idx_match_balls_over).
  readByOverBallIdx: index("idx_match_balls_over").on(
    table.matchId,
    table.inningsId,
    table.overNumber,
    table.ballNumber,
  ),
}));

export type MatchBall = typeof matchBalls.$inferSelect;
export type NewMatchBall = typeof matchBalls.$inferInsert;