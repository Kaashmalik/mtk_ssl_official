import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants } from "./tenants";
import { users } from "./users";
import { matches } from "./matches";

/**
 * Fan Reaction Reports — fan-facing reports on a match's reaction feed
 * (FAN-01, reports slice).
 *
 * The public reaction bar shows aggregate counts only, so a fan cannot
 * reference one specific reaction row: a report is per MATCH feed. One OPEN
 * report per fan per match (partial unique index `WHERE status = 'open'`;
 * re-reporting while open is an idempotent no-op; a new report after a
 * decision is allowed). The organizer decision (dismissed | actioned) is
 * append-provenance: reviewer identity + time REQUIRED, terminal states are
 * final. Actual removal of a specific reaction stays in the existing audited
 * moderation flow. Reports are moderation signals ONLY - they never feed
 * scoring, standings or awards, and no official decision reads them.
 */
export const fanReactionReports = pgTable(
  "fan_reaction_reports",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    matchId: uuid("match_id").notNull().references(() => matches.id, { onDelete: "cascade" }),
    reportedBy: uuid("reported_by").notNull().references(() => users.id, { onDelete: "cascade" }),
    // Constrained to the shared REACTION_REPORT_REASONS set by a DB CHECK.
    reason: text("reason").notNull(),
    status: text("status").notNull().default("open"),
    reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    // ONE open report per fan per match (DB-side dedupe; the writer's
    // onConflictDoNothing makes a re-report an idempotent no-op).
    uniqueOpenFanReport: sql`CREATE UNIQUE INDEX IF NOT EXISTS fan_reaction_reports_open_uidx ON ${table} (match_id, reported_by) WHERE status = 'open'`,
    queueIdx: index("fan_reaction_reports_open_queue_idx").on(table.tenantId, table.status, table.createdAt),
  }),
);
