import { pgEnum, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { index, uniqueIndex } from "drizzle-orm/pg-core";
import { matches } from "./matches";
import { tenants } from "./tenants";
import { users } from "./users";

/**
 * REG-05 (Batch 141): member-raised scorecard correction requests.
 * CORRECTION REQUESTS ARE RECORDS, NEVER MUTATIONS: raising one does not
 * change the scorecard, and even an approved request does not auto-edit
 * anything - the owner corrects data through the existing audited scoring
 * paths, keeping review and correction authorities apart. Reasons are a
 * FIXED set (free-text briefs are recorded future work); status is the
 * state machine open -> approved | dismissed (terminal either way); the
 * partial unique enforces "one OPEN request per member per match" at the
 * database; the resolution CHECK pins provenance.
 */
export const scorecardCorrectionReasonEnum = pgEnum("scorecard_correction_reason", [
  "wrong_runs",
  "wrong_wicket",
  "wrong_batter",
  "missing_player",
  "other",
]);

export const scorecardCorrectionStatusEnum = pgEnum("scorecard_correction_status", [
  "open",
  "approved",
  "dismissed",
]);

export const scorecardCorrectionRequests = pgTable("scorecard_correction_requests", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  matchId: uuid("match_id").notNull().references(() => matches.id, { onDelete: "cascade" }),
  requestedBy: uuid("requested_by").notNull().references(() => users.id, { onDelete: "cascade" }),
  reason: scorecardCorrectionReasonEnum("reason").notNull(),
  status: scorecardCorrectionStatusEnum("status").notNull().default("open"),
  raisedAt: timestamp("raised_at", { withTimezone: true }).defaultNow().notNull(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolvedBy: uuid("resolved_by").references(() => users.id, { onDelete: "set null" }),
}, (table) => [
  uniqueIndex("scorecard_correction_requests_one_open_per_member_key")
    .on(table.matchId, table.requestedBy)
    .where(sql`${table.status} = 'open'`),
  index("scorecard_correction_requests_open_match_idx")
    .on(table.matchId)
    .where(sql`${table.status} = 'open'`),
  index("scorecard_correction_requests_tenant_open_idx")
    .on(table.tenantId, table.raisedAt)
    .where(sql`${table.status} = 'open'`),
]);

export type ScorecardCorrectionRequest = typeof scorecardCorrectionRequests.$inferSelect;
export type NewScorecardCorrectionRequest = typeof scorecardCorrectionRequests.$inferInsert;
