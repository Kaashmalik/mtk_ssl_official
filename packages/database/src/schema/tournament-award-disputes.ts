import { pgTable, uuid, timestamp, pgEnum, check, uniqueIndex, index, foreignKey } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tournaments } from "./tournaments";
import { tournamentAwards } from "./tournament-awards";
import { users } from "./users";

/**
 * PUB-04 award dispute vocabularies. Reasons are a FIXED set (nothing
 * offensive is storable; no free text in this first slice — a longer dispute
 * brief is recorded future work). Status carries the resolution state machine:
 * open -> upheld | dismissed, terminal either way.
 */
export const awardDisputeReasonEnum = pgEnum("award_dispute_reason", [
  "incorrect_winner",
  "winner_ineligible",
  "process_error",
  "other",
]);

export const awardDisputeStatusEnum = pgEnum("award_dispute_status", [
  "open",
  "upheld",
  "dismissed",
]);

/**
 * PUB-04 award disputes. A registered member's formal challenge to an official
 * award. DISPUTES ARE RECORDS, NEVER MUTATIONS: raising one does not change
 * the award, and even an upheld dispute does not auto-supersede the
 * declaration — the owner separately corrects via the Batch 88 supersede
 * path, keeping the dispute-review and award-declaration authorities apart.
 * The partial unique makes "one OPEN dispute per member per award" a database
 * guarantee; the resolution CHECK pins provenance (open = no reviewer;
 * decided = reviewer AND time required).
 */
export const tournamentAwardDisputes = pgTable("tournament_award_disputes", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tournamentId: uuid("tournament_id").notNull(),
  tenantId: uuid("tenant_id").notNull(),
  awardId: uuid("award_id")
    .notNull()
    .references(() => tournamentAwards.id, { onDelete: "cascade" }),
  raisedBy: uuid("raised_by").notNull().references(() => users.id, { onDelete: "cascade" }),
  reason: awardDisputeReasonEnum("reason").notNull(),
  status: awardDisputeStatusEnum("status").notNull().default("open"),
  raisedAt: timestamp("raised_at", { withTimezone: true }).defaultNow().notNull(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolvedBy: uuid("resolved_by").references(() => users.id, { onDelete: "set null" }),
}, table => [
  foreignKey({ name: "tournament_award_disputes_match_tenant_fk", columns: [table.tournamentId, table.tenantId],
    foreignColumns: [tournaments.id, tournaments.tenantId] }).onDelete("cascade"),
  uniqueIndex("tournament_award_disputes_one_open_per_member_key")
    .on(table.awardId, table.raisedBy)
    .where(sql`${table.status} = 'open'`),
  index("tournament_award_disputes_open_award_idx").on(table.awardId)
    .where(sql`${table.status} = 'open'`),
  index("tournament_award_disputes_tenant_open_idx").on(table.tenantId, table.raisedAt)
    .where(sql`${table.status} = 'open'`),
  check("tournament_award_disputes_resolution_check", sql`
    (${table.status} = 'open' AND ${table.resolvedAt} IS NULL AND ${table.resolvedBy} IS NULL)
    OR (${table.status} IN ('upheld', 'dismissed') AND ${table.resolvedAt} IS NOT NULL AND ${table.resolvedBy} IS NOT NULL)`),
]);

export type TournamentAwardDispute = typeof tournamentAwardDisputes.$inferSelect;
export type NewTournamentAwardDispute = typeof tournamentAwardDisputes.$inferInsert;
