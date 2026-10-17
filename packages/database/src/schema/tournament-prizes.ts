import { pgTable, uuid, text, timestamp, numeric, pgEnum, index, type AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants } from "./tenants";
import { tournaments } from "./tournaments";
import { users } from "./users";

/**
 * PUB-05 prize lifecycle. Drafts are league-editable; approval is a one-way
 * organizer decision (the writer enforces it, the DB CHECK makes an approved
 * row's approver provenance mandatory). "Recorded payout" is the league's own
 * truthful record that it paid a prize out — the platform never verifies fund
 * transfer, so the column is deliberately named recorded_payout_at (a record,
 * not a verified fact).
 */
export const tournamentPrizeStatusEnum = pgEnum("tournament_prize_status", [
  "draft",
  "approved",
]);

/**
 * Tournament prizes (PUB-05). Prize categories are league-defined free text
 * (configurable, unlike the fixed award_category set of PUB-04): the
 * tournament's organizers declare what is on offer, for which placement,
 * optionally with an amount + currency and sponsor attribution. A null amount
 * is a valid non-cash prize (trophy, title, opportunity). Approval freezes
 * the row; a CORRECTION never rewrites it — an approved prize is superseded
 * by a corrected replacement row (superseded_at + superseded_by_prize_id
 * provenance), keeping the frozen history intact auditable truth.
 */
export const tournamentPrizes = pgTable("tournament_prizes", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  tournamentId: uuid("tournament_id").notNull().references(() => tournaments.id, { onDelete: "cascade" }),
  categoryName: text("category_name").notNull(),
  placement: text("placement"),
  /** Null = non-cash prize. Numeric(12,2); the app tier normalizes to 2dp strings. */
  amount: numeric("amount", { precision: 12, scale: 2 }),
  currency: text("currency").notNull().default("PKR"),
  sponsor: text("sponsor"),
  status: tournamentPrizeStatusEnum("status").notNull().default("draft"),
  approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  /**
   * Supersede provenance: when this approved prize was replaced by a
   * corrected row, and which row replaced it. Null = the prize is ACTIVE.
   * A superseded row is history — never publicly visible, never editable.
   */
  supersededAt: timestamp("superseded_at", { withTimezone: true }),
  supersededByPrizeId: uuid("superseded_by_prize_id").references((): AnyPgColumn => tournamentPrizes.id, { onDelete: "set null" }),
  /** The league's record that the prize was paid out — not a verified fact. */
  recordedPayoutAt: timestamp("recorded_payout_at", { withTimezone: true }),
  payoutReference: text("payout_reference"),
  payoutNote: text("payout_note"),
  createdBy: uuid("created_by").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ([
  index("tournament_prizes_tenant_idx").on(table.tenantId),
  index("tournament_prizes_tournament_idx").on(table.tournamentId),
  index("tournament_prizes_superseded_idx").on(table.tournamentId, table.supersededAt),
]));

export type TournamentPrize = typeof tournamentPrizes.$inferSelect;
export type NewTournamentPrize = typeof tournamentPrizes.$inferInsert;
