import { pgTable, uuid, text, integer, timestamp, jsonb, pgEnum, index, unique } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants } from "./tenants";
import { tournaments } from "./tournaments";
import { users } from "./users";

/**
 * FAN-01 moderated polls lifecycle. The poll QUESTION and OPTIONS are
 * league-owner-authored content (moderated at the source: nothing a fan
 * writes is ever stored), so free text exists only on the organizer side.
 * Fans contribute VOTES only - one active vote per fan per poll, switchable
 * while the poll is open. Votes are engagement signals ONLY: they never feed
 * scoring, standings, or awards, and no official decision can read them.
 */
export const tournamentPollStatusEnum = pgEnum("tournament_poll_status", [
  "draft",
  "open",
  "closed",
]);

export const tournamentPolls = pgTable("tournament_polls", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  tournamentId: uuid("tournament_id").notNull().references(() => tournaments.id, { onDelete: "cascade" }),
  /** Owner-authored question - moderated at the source (only owners create polls). */
  question: text("question").notNull(),
  /** Owner-authored options as a JSON string array of 2-10 entries; order IS the option identity. */
  options: jsonb("options").notNull(),
  status: tournamentPollStatusEnum("status").notNull().default("draft"),
  createdBy: uuid("created_by").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  tournamentIdx: index("tournament_polls_tournament_idx").on(table.tournamentId),
}));

export const tournamentPollVotes = pgTable("tournament_poll_votes", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  pollId: uuid("poll_id").notNull().references((): typeof tournamentPolls.id => tournamentPolls.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  /** Index into the poll's options array (0-based); validated by policy + writer. */
  optionIndex: integer("option_index").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  // One ACTIVE vote per fan per poll; switching updates the row in place.
  uniquePollFan: unique("tournament_poll_votes_poll_fan_uidx").on(table.pollId, table.userId),
  pollIdx: index("tournament_poll_votes_poll_idx").on(table.pollId),
}));

export type TournamentPoll = typeof tournamentPolls.$inferSelect;
export type NewTournamentPoll = typeof tournamentPolls.$inferInsert;
export type TournamentPollVote = typeof tournamentPollVotes.$inferSelect;
export type NewTournamentPollVote = typeof tournamentPollVotes.$inferInsert;
