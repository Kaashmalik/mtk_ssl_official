import { pgTable, uuid, text, timestamp, integer, decimal, pgEnum, boolean } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants } from "./tenants";
import { tournaments } from "./tournaments";
import { users } from "./users";

export const fantasyStatusEnum = pgEnum("fantasy_status", ["draft", "active", "completed", "cancelled"]);

export const fantasyLeagues = pgTable("fantasy_leagues", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  tournamentId: uuid("tournament_id").notNull().references(() => tournaments.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  maxTeams: integer("max_teams").notNull().default(20),
  entryFee: decimal("entry_fee", { precision: 10, scale: 2 }).default("0"),
  prizePool: decimal("prize_pool", { precision: 12, scale: 2 }).default("0"),
  status: fantasyStatusEnum("status").notNull().default("draft"),
  draftDeadline: timestamp("draft_deadline", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const fantasyTeams = pgTable("fantasy_teams", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  leagueId: uuid("league_id").notNull().references(() => fantasyLeagues.id, { onDelete: "cascade" }),
  ownerId: uuid("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  teamName: text("team_name").notNull(),
  totalPoints: integer("total_points").default(0).notNull(),
  rank: integer("rank"),
  budgetRemaining: decimal("budget_remaining", { precision: 10, scale: 2 }).default("100000"),
  isPaid: boolean("is_paid").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const fantasyTeamPlayers = pgTable("fantasy_team_players", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  fantasyTeamId: uuid("fantasy_team_id").notNull().references(() => fantasyTeams.id, { onDelete: "cascade" }),
  playerId: uuid("player_id").notNull(),
  role: text("role").notNull(), // batsman, bowler, all-rounder, wicket-keeper
  isCaptain: boolean("is_captain").default(false).notNull(),
  isViceCaptain: boolean("is_vice_captain").default(false).notNull(),
  cost: decimal("cost", { precision: 10, scale: 2 }).notNull(),
  totalPoints: integer("total_points").default(0).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const fantasyPointsRules = pgTable("fantasy_points_rules", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  event: text("event").notNull(), // run, four, six, wicket, catch, etc.
  points: integer("points").notNull(),
  multiplier: decimal("multiplier", { precision: 3, scale: 1 }).default("1.0"),
  description: text("description"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const fantasyMatchPoints = pgTable("fantasy_match_points", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  matchId: uuid("match_id").notNull(),
  fantasyTeamId: uuid("fantasy_team_id").notNull().references(() => fantasyTeams.id, { onDelete: "cascade" }),
  playerId: uuid("player_id").notNull(),
  points: integer("points").notNull(),
  breakdown: text("breakdown"), // JSON string of point breakdown
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type FantasyLeague = typeof fantasyLeagues.$inferSelect;
export type NewFantasyLeague = typeof fantasyLeagues.$inferInsert;
export type FantasyTeam = typeof fantasyTeams.$inferSelect;
export type FantasyTeamPlayer = typeof fantasyTeamPlayers.$inferSelect;
