import { pgTable, uuid, text, timestamp, decimal, pgEnum } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants } from "./tenants";
import { tournaments } from "./tournaments";
import { teams } from "./teams";
import { users } from "./users";

/**
 * Registration status enum
 */
export const registrationStatusEnum = pgEnum("registration_status", [
  "pending",
  "approved",
  "rejected",
  "withdrawn",
  "waitlisted",
]);

/**
 * Payment status enum for registration fees
 */
export const registrationPaymentStatusEnum = pgEnum("registration_payment_status", [
  "unpaid",
  "paid",
  "refunded",
  "waived",
]);

/**
 * League Registrations — Teams registering for tournaments
 * with approval workflow and payment tracking.
 */
export const leagueRegistrations = pgTable("league_registrations", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  tournamentId: uuid("tournament_id").notNull().references(() => tournaments.id, { onDelete: "cascade" }),
  teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),

  // Registration details
  status: registrationStatusEnum("status").notNull().default("pending"),
  registeredBy: uuid("registered_by").notNull().references(() => users.id),
  approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
  rejectionReason: text("rejection_reason"),

  // Payment
  registrationFee: decimal("registration_fee", { precision: 10, scale: 2 }).default("0"),
  paymentStatus: registrationPaymentStatusEnum("payment_status").notNull().default("unpaid"),
  paymentTransactionId: text("payment_transaction_id"),

  // Squad — stored as JSON array of player IDs
  squadPlayerIds: uuid("squad_player_ids").array().default([]),
  notes: text("notes"),

  // Timestamps
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  uniqueTeamTournament: sql`UNIQUE (${table.teamId}, ${table.tournamentId})`,
}));

export type LeagueRegistration = typeof leagueRegistrations.$inferSelect;
export type NewLeagueRegistration = typeof leagueRegistrations.$inferInsert;
