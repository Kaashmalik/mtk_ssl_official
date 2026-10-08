import { pgTable, uuid, integer, timestamp, text, decimal, pgEnum } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants } from "./tenants";
import { matches } from "./matches";
import { matchInnings } from "./match-innings";
import { players } from "./players";
import { teams } from "./teams";

/**
 * Dismissal type enum — how a batsman got out
 */
export const dismissalTypeEnum = pgEnum("dismissal_type", [
  "bowled",
  "caught",
  "caught_behind",
  "caught_and_bowled",
  "lbw",
  "run_out",
  "stumped",
  "hit_wicket",
  "retired",
  "retired_hurt",
  "obstructing_field",
  "timed_out",
  "handled_ball",
  "not_out",
]);

/**
 * Batting Scorecards — Individual batsman performance per innings
 */
export const battingScorecards = pgTable("batting_scorecards", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  matchId: uuid("match_id").notNull().references(() => matches.id, { onDelete: "cascade" }),
  inningsId: uuid("innings_id").notNull().references(() => matchInnings.id, { onDelete: "cascade" }),
  teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
  playerId: uuid("player_id").notNull().references(() => players.id, { onDelete: "cascade" }),

  // Batting performance
  battingPosition: integer("batting_position").notNull(),
  runs: integer("runs").default(0).notNull(),
  ballsFaced: integer("balls_faced").default(0).notNull(),
  fours: integer("fours").default(0).notNull(),
  sixes: integer("sixes").default(0).notNull(),
  strikeRate: decimal("strike_rate", { precision: 8, scale: 2 }).default("0"),

  // Dismissal
  dismissalType: dismissalTypeEnum("dismissal_type").default("not_out"),
  bowlerId: uuid("bowler_id").references(() => players.id, { onDelete: "set null" }),  // Who bowled
  fielderId: uuid("fielder_id").references(() => players.id, { onDelete: "set null" }), // Who caught/ran out
  dismissalText: text("dismissal_text"), // e.g., "c Kohli b Bumrah"

  // Minutes at crease (optional)
  minutesBatted: integer("minutes_batted"),
  dotBalls: integer("dot_balls").default(0),

  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  uniquePlayerInnings: sql`UNIQUE (${table.playerId}, ${table.inningsId})`,
}));

/**
 * Bowling Scorecards — Individual bowler performance per innings
 */
export const bowlingScorecards = pgTable("bowling_scorecards", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  matchId: uuid("match_id").notNull().references(() => matches.id, { onDelete: "cascade" }),
  inningsId: uuid("innings_id").notNull().references(() => matchInnings.id, { onDelete: "cascade" }),
  teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
  playerId: uuid("player_id").notNull().references(() => players.id, { onDelete: "cascade" }),

  // Bowling performance
  bowlingPosition: integer("bowling_position").notNull(), // Order of bowling
  overs: decimal("overs", { precision: 5, scale: 1 }).default("0").notNull(),
  ballsBowled: integer("balls_bowled").default(0).notNull(),
  maidens: integer("maidens").default(0).notNull(),
  runsConceded: integer("runs_conceded").default(0).notNull(),
  wickets: integer("wickets").default(0).notNull(),
  economyRate: decimal("economy_rate", { precision: 6, scale: 2 }).default("0"),
  dotBalls: integer("dot_balls").default(0),
  wides: integer("wides").default(0).notNull(),
  noBalls: integer("no_balls").default(0).notNull(),
  fours: integer("fours_conceded").default(0).notNull(),
  sixes: integer("sixes_conceded").default(0).notNull(),

  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  uniqueBowlerInnings: sql`UNIQUE (${table.playerId}, ${table.inningsId})`,
}));

/**
 * Fielding Scorecards — Fielding contributions per match
 */
export const fieldingScorecards = pgTable("fielding_scorecards", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  matchId: uuid("match_id").notNull().references(() => matches.id, { onDelete: "cascade" }),
  teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
  playerId: uuid("player_id").notNull().references(() => players.id, { onDelete: "cascade" }),

  catches: integer("catches").default(0).notNull(),
  runOuts: integer("run_outs").default(0).notNull(),
  stumpings: integer("stumpings").default(0).notNull(),
  directHits: integer("direct_hits").default(0).notNull(),
  droppedCatches: integer("dropped_catches").default(0).notNull(),

  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  uniqueFielderMatch: sql`UNIQUE (${table.playerId}, ${table.matchId})`,
}));

export type BattingScorecard = typeof battingScorecards.$inferSelect;
export type NewBattingScorecard = typeof battingScorecards.$inferInsert;
export type BowlingScorecard = typeof bowlingScorecards.$inferSelect;
export type NewBowlingScorecard = typeof bowlingScorecards.$inferInsert;
export type FieldingScorecard = typeof fieldingScorecards.$inferSelect;
export type NewFieldingScorecard = typeof fieldingScorecards.$inferInsert;
