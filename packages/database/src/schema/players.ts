import { pgTable, uuid, integer, timestamp, date, boolean, text, pgEnum } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants } from "./tenants";
import { teams } from "./teams";
import { users } from "./users";
import { profiles } from "./profiles";

/**
 * Player role enum
 */
export const playerRoleEnum = pgEnum("player_role", [
  "batsman",
  "bowler",
  "all_rounder",
  "wicket_keeper",
  "wicket_keeper_batsman",
]);

/**
 * Batting style enum
 */
export const battingStyleEnum = pgEnum("batting_style", ["right", "left"]);

/**
 * Bowling style enum
 */
export const bowlingStyleEnum = pgEnum("bowling_style", [
  "right_arm_fast",
  "right_arm_medium",
  "right_arm_spin",
  "left_arm_fast",
  "left_arm_medium",
  "left_arm_spin",
]);

/**
 * Player status enum
 */
export const playerStatusEnum = pgEnum("player_status", [
  "active",
  "injured",
  "retired",
  "suspended",
  "inactive",
]);

/**
 * Players table — Complete player profiles with cricket-specific data
 */
export const players = pgTable("players", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  teamId: uuid("team_id").references(() => teams.id, { onDelete: "set null" }),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  profileId: uuid("profile_id").references(() => profiles.id, { onDelete: "set null" }),

  // Personal Information
  name: text("name").notNull(),
  photoUrl: text("photo_url"),
  dateOfBirth: date("date_of_birth"),
  phone: text("phone"),
  email: text("email"),
  nationality: text("nationality"),
  city: text("city"),

  // Physical Stats
  heightCm: integer("height_cm"),
  weightKg: integer("weight_kg"),

  // Cricket Details
  jerseyNumber: integer("jersey_number"),
  role: playerRoleEnum("role"),
  battingStyle: battingStyleEnum("batting_style"),
  bowlingStyle: bowlingStyleEnum("bowling_style"),
  biography: text("biography"),

  // Status
  status: playerStatusEnum("status").default("active").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  joinedAt: date("joined_at"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type Player = typeof players.$inferSelect;
export type NewPlayer = typeof players.$inferInsert;
