import { pgTable, uuid, text, timestamp, pgEnum, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants } from "./tenants";
import { tournaments } from "./tournaments";
import { players } from "./players";
import { teams } from "./teams";
import { users } from "./users";

/**
 * PUB-04 award categories. Official awards only; fan favorites are a separate
 * concern that must never be stored in (or ranked against) this table.
 */
export const awardCategoryEnum = pgEnum("award_category", [
  "player_of_the_tournament",
  "best_batsman",
  "best_bowler",
  "best_all_rounder",
  "best_fielder",
  "best_wicketkeeper",
  "emerging_player",
  "fair_play",
]);

/**
 * Official tournament awards (PUB-04 first slice). Exactly one winner per row
 * (player or team - DB CHECK); corrections supersede instead of mutating, so
 * an organizer's decision trail is preserved. Public display is gated by the
 * tournament's publication status AND superseded_at being null.
 */
export const tournamentAwards = pgTable("tournament_awards", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  tournamentId: uuid("tournament_id").notNull().references(() => tournaments.id, { onDelete: "cascade" }),
  category: awardCategoryEnum("category").notNull(),
  playerId: uuid("player_id").references(() => players.id, { onDelete: "set null" }),
  teamId: uuid("team_id").references(() => teams.id, { onDelete: "set null" }),
  citation: text("citation"),
  declaredBy: uuid("declared_by").notNull().references(() => users.id, { onDelete: "cascade" }),
  declaredAt: timestamp("declared_at", { withTimezone: true }).defaultNow().notNull(),
  /** Set when a later correction replaces this row; superseded rows are history. */
  supersededAt: timestamp("superseded_at", { withTimezone: true }),
}, (table) => ([
  index("tournament_awards_tenant_idx").on(table.tenantId),
  index("tournament_awards_active_tournament_idx").on(table.tournamentId)
    .where(sql`${table.supersededAt} IS NULL`),
]));

export type TournamentAward = typeof tournamentAwards.$inferSelect;
export type NewTournamentAward = typeof tournamentAwards.$inferInsert;
