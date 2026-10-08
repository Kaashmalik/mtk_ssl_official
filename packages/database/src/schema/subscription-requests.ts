import { pgTable, uuid, text, timestamp, decimal, pgEnum } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants } from "./tenants";
import { users } from "./users";

/**
 * Subscription request status enum — used for the manual payment approval queue.
 */
export const subscriptionRequestStatusEnum = pgEnum(
  "subscription_request_status",
  ["pending", "approved", "rejected", "expired"]
);

/**
 * Subscription Requests table — the approval queue for paid plan upgrades.
 *
 * Flow:
 *   1. Tenant user uploads a payment proof + transaction reference.
 *   2. A row is created here with status = 'pending'.
 *   3. Super admin reviews in the admin panel.
 *   4. On approval: tenant plan upgrades, subscription + payment rows created.
 *   5. On rejection: admin notes recorded, plan stays unchanged.
 *   6. Requests auto-expire after 7 days if not reviewed.
 */
export const subscriptionRequests = pgTable("subscription_requests", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  requestedPlan: text("requested_plan").notNull(), // 'starter' | 'pro' | 'enterprise'
  currentPlan: text("current_plan").notNull(),     // existing plan before upgrade
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  paymentMethod: text("payment_method").notNull(), // 'bank_transfer' | 'jazzcash_manual' | 'easypaisa_manual'
  paymentProofUrl: text("payment_proof_url").notNull(), // Uploaded receipt image URL
  transactionReference: text("transaction_reference").notNull(), // Bank transfer ref / txn ID
  status: subscriptionRequestStatusEnum("status").notNull().default("pending"),
  adminNotes: text("admin_notes"),
  reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "set null" }),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(), // 7 days from creation
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type SubscriptionRequest = typeof subscriptionRequests.$inferSelect;
export type NewSubscriptionRequest = typeof subscriptionRequests.$inferInsert;
