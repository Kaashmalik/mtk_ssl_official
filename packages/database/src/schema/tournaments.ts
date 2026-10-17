import { pgTable, uuid, text, timestamp, date, integer, boolean, jsonb, numeric, pgEnum } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants } from "./tenants";
import { users } from "./users";
// NOTE: the champion FK (champion_team_id -> teams.id) is deliberately NOT
// declared with references() here - teams.ts already imports tournaments,
// and a schema-level back-reference created a TS7022 circular-init error.
// The FK is owned by migration 20261018100000; joins to the champion team
// are made explicitly by the readers that need it.

/**
 * Tournament format enum
 */
export const tournamentFormatEnum = pgEnum("tournament_format", ["knockout", "league", "hybrid", "round_robin"]);

/**
 * Tournament status enum
 */
export const tournamentStatusEnum = pgEnum("tournament_status", ["draft", "registration", "live", "completed", "cancelled"]);

/**
 * Tournaments table
 */
export const tournaments = pgTable("tournaments", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  description: text("description"),
  format: tournamentFormatEnum("format").notNull(),
  startDate: date("start_date"),
  endDate: date("end_date"),
  registrationOpen: boolean("registration_open").default(false).notNull(),
  registrationStart: timestamp("registration_start", { withTimezone: true }),
  registrationEnd: timestamp("registration_end", { withTimezone: true }),
  registrationDeadline: date("registration_deadline"),
  maxTeams: integer("max_teams"),
  entryFee: numeric("entry_fee", { precision: 10, scale: 2 }).default("0"),
  prizePool: jsonb("prize_pool"),
  rules: jsonb("rules"),
  sponsors: jsonb("sponsors"),
  liveStreamUrl: text("live_stream_url"),
  isFeatured: boolean("is_featured").default(false).notNull(),
  status: tournamentStatusEnum("status").notNull().default("draft"),
  // FAN-03 hall of fame: the champion of a completed knockout competition,
  // written exactly once by the TOURNAMENT_ADVANCE completion claim from the
  // decided final's winner. Never backfilled - legacy completed tournaments
  // read champion-less rather than guess which fixture was the final. The
  // teams FK is migration-owned (see the note at the top of this file).
  championTeamId: uuid("champion_team_id"),
  // COMP-07 competition lock: engagement is EXPLICIT ONLY (audited
  // setCompetitionLock by a league owner) — status transitions never set
  // or clear these. See packages/database/src/lib/competition-locks.ts
  competitionLockedAt: timestamp("competition_locked_at", { withTimezone: true }),
  competitionLockedBy: uuid("competition_locked_by").references(() => users.id),
  createdBy: uuid("created_by").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  uniqueTenantSlug: sql`UNIQUE (${table.tenantId}, ${table.slug})`,
}));

export type Tournament = typeof tournaments.$inferSelect;
export type NewTournament = typeof tournaments.$inferInsert;

