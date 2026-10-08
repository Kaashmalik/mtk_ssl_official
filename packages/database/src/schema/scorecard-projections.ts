import { pgTable, uuid, integer, timestamp, bigint } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants } from "./tenants";
import { matches } from "./matches";
import { teams } from "./teams";

/**
 * Scorecard projections table — Fast read model for match/innings aggregates
 */
export const scorecardProjections = pgTable("scorecard_projections", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  matchId: uuid("match_id").notNull().references(() => matches.id, { onDelete: "cascade" }),
  inningsId: uuid("innings_id").notNull(),
  inningsNumber: integer("innings_number").notNull(),
  teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
  
  totalRuns: integer("total_runs").default(0).notNull(),
  totalWickets: integer("total_wickets").default(0).notNull(),
  totalBalls: integer("total_balls").default(0).notNull(),
  totalExtras: integer("total_extras").default(0).notNull(),
  wides: integer("wides").default(0).notNull(),
  noBalls: integer("no_balls").default(0).notNull(),
  byes: integer("byes").default(0).notNull(),
  legByes: integer("leg_byes").default(0).notNull(),
  
  currentOver: integer("current_over").default(0).notNull(),
  currentBall: integer("current_ball").default(0).notNull(),
  
  lastEventSequence: bigint("last_event_sequence", { mode: "number" }).default(0).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type ScorecardProjection = typeof scorecardProjections.$inferSelect;
export type NewScorecardProjection = typeof scorecardProjections.$inferInsert;
