import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants } from "./tenants";
import { users } from "./users";

/**
 * Fan Blocks — league-scoped fan interaction blocks (FAN-01, anti-abuse
 * slice).
 *
 * Reports closed the fan->organizer loop; blocks close organizer->abuser.
 * A block is LEAGUE-SCOPED (tenant + fan): the league owner stops one fan
 * from reacting to or reporting on any match of THEIR league - it never
 * reaches another league and is never feed-permanent (only active/lifted
 * exist; the lift carries reviewer provenance, DB CHECK). One ACTIVE block
 * per fan per league (partial unique index `WHERE status = 'active'`; a
 * re-block while active is an idempotent no-op at the writer). Enforcement
 * lives in the engagement writers (reactions + reports), fail-closed;
 * follows are NOT gated by this table in this slice. Blocks are anti-abuse
 * signals ONLY - they never feed scoring, standings or awards.
 */
export const fanBlocks = pgTable(
  "fan_blocks",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    blockedUserId: uuid("blocked_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    blockedBy: uuid("blocked_by").notNull().references(() => users.id, { onDelete: "cascade" }),
    // Constrained to the shared FAN_BLOCK_REASONS set by a DB CHECK.
    reason: text("reason").notNull().default("report_abuse"),
    status: text("status").notNull().default("active"),
    liftedBy: uuid("lifted_by").references(() => users.id, { onDelete: "set null" }),
    liftedAt: timestamp("lifted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    // ONE active block per fan per league (DB-side dedupe; the writer's
    // onConflictDoNothing makes a re-block an idempotent no-op).
    uniqueActiveFanBlock: sql`CREATE UNIQUE INDEX IF NOT EXISTS fan_blocks_active_uidx ON ${table} (tenant_id, blocked_user_id) WHERE status = 'active'`,
    historyIdx: index("fan_blocks_history_idx").on(table.tenantId, table.createdAt),
  }),
);
