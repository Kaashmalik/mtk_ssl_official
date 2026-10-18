import { pgTable, uuid, smallint, boolean, timestamp, check, uniqueIndex, index, foreignKey } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { matches } from "./matches";
import { teams } from "./teams";
import { players } from "./players";
import { users } from "./users";

/**
 * Declared playing XIs (COMP-06 slice). One row per (match, side, player) with
 * a stable batting order. Rows are immutable declarations: a re-declaration
 * supersedes the previously active rows (superseded_at) instead of mutating
 * them, so declarations stay auditable. Both composite FKs bind the row to the
 * same-league match and team; delivery-time enforcement lives with the shared
 * XI policy and the canonical scoring boundary.
 */
export const matchPlayingXis = pgTable("match_playing_xis", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  matchId: uuid("match_id").notNull(),
  tenantId: uuid("tenant_id").notNull(),
  teamId: uuid("team_id").notNull(),
  playerId: uuid("player_id").notNull().references(() => players.id, { onDelete: "cascade" }),
  battingOrder: smallint("batting_order").notNull(),
  /** Owner or assigned scorer who stored the declaration. */
  declaredBy: uuid("declared_by").notNull().references(() => users.id, { onDelete: "cascade" }),
  declaredAt: timestamp("declared_at", { withTimezone: true }).defaultNow().notNull(),
  /** Set by a later re-declaration; superseded rows are history, never deleted. */
  supersededAt: timestamp("superseded_at", { withTimezone: true }),
  /**
   * PUB-03/COMP-06: this slot is the side's designated wicketkeeper. At most
   * one per active side (partial unique); legacy pre-migration rows read
   * false - no keeper is invented for history.
   */
  wicketkeeper: boolean("wicketkeeper").default(false).notNull(),
}, table => [
  foreignKey({ name: "match_playing_xis_match_tenant_fk", columns: [table.matchId, table.tenantId],
    foreignColumns: [matches.id, matches.tenantId] }).onDelete("cascade"),
  foreignKey({ name: "match_playing_xis_team_tenant_fk", columns: [table.teamId, table.tenantId],
    foreignColumns: [teams.id, teams.tenantId] }).onDelete("cascade"),
  uniqueIndex("match_playing_xis_active_player_key").on(table.matchId, table.teamId, table.playerId)
    .where(sql`${table.supersededAt} IS NULL`),
  uniqueIndex("match_playing_xis_active_order_key").on(table.matchId, table.teamId, table.battingOrder)
    .where(sql`${table.supersededAt} IS NULL`),
  index("match_playing_xis_active_idx").on(table.matchId, table.teamId)
    .where(sql`${table.supersededAt} IS NULL`),
  check("match_playing_xis_order_check", sql`${table.battingOrder} >= 1 AND ${table.battingOrder} <= 11`),
]);

export type MatchPlayingXi = typeof matchPlayingXis.$inferSelect;
export type NewMatchPlayingXi = typeof matchPlayingXis.$inferInsert;
