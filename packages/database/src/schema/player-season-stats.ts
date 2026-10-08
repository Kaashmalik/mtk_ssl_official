import { pgTable, uuid, integer, timestamp, decimal, boolean } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants } from "./tenants";
import { players } from "./players";
import { tournaments } from "./tournaments";

/**
 * Player Season Stats — Aggregated per-player, per-tournament statistics.
 * Updated automatically after each match scorecard is finalized.
 */
export const playerSeasonStats = pgTable("player_season_stats", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  playerId: uuid("player_id").notNull().references(() => players.id, { onDelete: "cascade" }),
  tournamentId: uuid("tournament_id").notNull().references(() => tournaments.id, { onDelete: "cascade" }),

  // Matches
  matchesPlayed: integer("matches_played").default(0).notNull(),

  // Batting
  runsScored: integer("runs_scored").default(0).notNull(),
  ballsFaced: integer("balls_faced").default(0).notNull(),
  inningsBatted: integer("innings_batted").default(0).notNull(),
  notOuts: integer("not_outs").default(0).notNull(),
  fours: integer("fours").default(0).notNull(),
  sixes: integer("sixes").default(0).notNull(),
  highestScore: integer("highest_score").default(0).notNull(),
  isHighestScoreNotOut: boolean("is_highest_score_not_out").default(false).notNull(),
  fifties: integer("fifties").default(0).notNull(),
  hundreds: integer("hundreds").default(0).notNull(),
  ducks: integer("ducks").default(0).notNull(),
  battingAverage: decimal("batting_average", { precision: 8, scale: 2 }).default("0"),
  strikeRate: decimal("strike_rate", { precision: 8, scale: 2 }).default("0"),

  // Bowling
  wicketsTaken: integer("wickets_taken").default(0).notNull(),
  oversBowled: decimal("overs_bowled", { precision: 8, scale: 1 }).default("0"),
  ballsBowled: integer("balls_bowled").default(0).notNull(),
  runsConceded: integer("runs_conceded").default(0).notNull(),
  inningsBowled: integer("innings_bowled").default(0).notNull(),
  maidens: integer("maidens").default(0).notNull(),
  bowlingAverage: decimal("bowling_average", { precision: 8, scale: 2 }).default("0"),
  economyRate: decimal("economy_rate", { precision: 8, scale: 2 }).default("0"),
  bowlingStrikeRate: decimal("bowling_strike_rate", { precision: 8, scale: 2 }).default("0"),
  bestBowlingWickets: integer("best_bowling_wickets").default(0).notNull(),
  bestBowlingRuns: integer("best_bowling_runs").default(0).notNull(),
  fourWicketHauls: integer("four_wicket_hauls").default(0).notNull(),
  fiveWicketHauls: integer("five_wicket_hauls").default(0).notNull(),

  // Fielding
  catches: integer("catches").default(0).notNull(),
  runOuts: integer("run_outs").default(0).notNull(),
  stumpings: integer("stumpings").default(0).notNull(),

  // Metadata
  lastUpdatedMatchId: uuid("last_updated_match_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  uniquePlayerTournament: sql`UNIQUE (${table.playerId}, ${table.tournamentId})`,
}));

export type PlayerSeasonStats = typeof playerSeasonStats.$inferSelect;
export type NewPlayerSeasonStats = typeof playerSeasonStats.$inferInsert;
