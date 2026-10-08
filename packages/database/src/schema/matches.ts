import { pgTable, uuid, text, timestamp, integer, pgEnum } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants } from "./tenants";
import { tournaments } from "./tournaments";
import { teams } from "./teams";
import { venues } from "./venues";
import { players } from "./players";
import { users } from "./users";

/**
 * Match format enum
 */
export const matchFormatEnum = pgEnum("match_format", ["t20", "odi", "test", "t10", "custom"]);

/**
 * Match type enum
 */
export const matchTypeEnum = pgEnum("match_type", [
  "group",
  "knockout",
  "final",
  "semi_final",
  "quarter_final",
  "friendly",
  "practice",
]);

/**
 * Match status enum
 */
export const matchStatusEnum = pgEnum("match_status", [
  "scheduled",
  "toss",
  "live",
  "innings_break",
  "completed",
  "abandoned",
  "cancelled",
  "no_result",
]);

/**
 * Toss decision enum
 */
export const tossDecisionEnum = pgEnum("toss_decision", ["bat", "bowl"]);

/**
 * Live stream source enum
 */
export const streamSourceEnum = pgEnum("stream_source", ["facebook", "youtube", "rtmp", "webrtc"]);

/**
 * Live stream status enum
 */
export const streamStatusEnum = pgEnum("stream_status", ["idle", "live", "ended"]);

/**
 * Matches table — Complete match data with format, overs, officials
 */
export const matches = pgTable("matches", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  tournamentId: uuid("tournament_id").references(() => tournaments.id, { onDelete: "set null" }),

  // Teams
  teamAId: uuid("team_a_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
  teamBId: uuid("team_b_id").notNull().references(() => teams.id, { onDelete: "cascade" }),

  // Venue & Schedule
  venueId: uuid("venue_id").references(() => venues.id, { onDelete: "set null" }),
  matchNumber: integer("match_number"),
  scheduledDate: timestamp("scheduled_date", { withTimezone: true }),
  startDate: timestamp("start_date", { withTimezone: true }),
  endDate: timestamp("end_date", { withTimezone: true }),

  // Match Config
  matchFormat: matchFormatEnum("match_format").notNull().default("t20"),
  matchType: matchTypeEnum("match_type").notNull().default("group"),
  totalOvers: integer("total_overs").default(20),
  status: matchStatusEnum("status").notNull().default("scheduled"),

  // Toss
  tossWinnerId: uuid("toss_winner_id").references(() => teams.id),
  tossDecision: tossDecisionEnum("toss_decision"),

  // Result
  winnerId: uuid("winner_id").references(() => teams.id),
  result: text("result"), // e.g., "Team A won by 5 wickets"
  manOfMatchId: uuid("man_of_match_id").references(() => players.id, { onDelete: "set null" }),

  // Officials
  umpire1: text("umpire_1"),
  umpire2: text("umpire_2"),
  thirdUmpire: text("third_umpire"),
  matchReferee: text("match_referee"),

  // Live streaming
  liveStreamUrl: text("live_stream_url"),
  streamSource: streamSourceEnum("stream_source"),
  streamStatus: streamStatusEnum("stream_status").notNull().default("idle"),

  // Scorer assignment
  scorerId: uuid("scorer_id").references(() => users.id, { onDelete: "set null" }),

  // Metadata
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type Match = typeof matches.$inferSelect;
export type NewMatch = typeof matches.$inferInsert;
