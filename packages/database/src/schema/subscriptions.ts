import { pgTable, uuid, text, timestamp, boolean, decimal, jsonb, pgEnum } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants } from "./tenants";
import { users } from "./users";

/**
 * Subscription status enum
 */
export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "active",
  "canceled",
  "past_due",
  "trialing",
  "paused",
]);

/**
 * Payment method enum
 */
export const paymentMethodEnum = pgEnum("payment_method", [
  "jazzcash",
  "easypaisa",
  "stripe",
  "bank_transfer",
]);

/**
 * Subscriptions table - Tracks tenant subscriptions and revenue
 */
export const subscriptions = pgTable("subscriptions", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  plan: text("plan").notNull(), // 'free', 'pro', 'enterprise'
  status: subscriptionStatusEnum("status").notNull().default("active"),
  monthlyAmount: decimal("monthly_amount", { precision: 10, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("PKR"),
  paymentMethod: paymentMethodEnum("payment_method"),
  currentPeriodStart: timestamp("current_period_start", { withTimezone: true }).notNull(),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }).notNull(),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").default(false).notNull(),
  canceledAt: timestamp("canceled_at", { withTimezone: true }),
  trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Payments table - Individual payment transactions
 * Includes extended columns from the microservices schema (migration 004)
 * for tournament registration, sponsorship, donations, and refunds.
 */
export const payments = pgTable("payments", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  subscriptionId: uuid("subscription_id").references(() => subscriptions.id, { onDelete: "set null" }),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  currency: text("currency").notNull().default("PKR"),
  paymentMethod: paymentMethodEnum("payment_method").notNull(),
  status: text("status").notNull().default("pending"), // 'pending', 'completed', 'failed', 'refunded'
  transactionId: text("transaction_id"),
  externalPaymentId: text("external_payment_id"), // JazzCash/EasyPaisa/Stripe ID
  providerResponse: jsonb("provider_response"), // Raw provider webhook/ response payload
  commissionAmount: decimal("commission_amount", { precision: 10, scale: 2 }),
  paidAt: timestamp("paid_at", { withTimezone: true }),
  // Extended payment metadata (migration 004 microservices schema)
  paymentType: text("payment_type"), // 'tournament_registration' | 'subscription' | 'sponsorship' | 'donation' | 'other'
  referenceId: uuid("reference_id"), // Polymorphic ref (e.g. tournament_id, registration_id)
  referenceType: text("reference_type"),
  description: text("description"),
  metadata: jsonb("metadata").default({}),
  // Refund tracking
  refundedAmount: decimal("refunded_amount", { precision: 12, scale: 2 }).default("0"),
  refundReason: text("refund_reason"),
  refundedAt: timestamp("refunded_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type Subscription = typeof subscriptions.$inferSelect;
export type NewSubscription = typeof subscriptions.$inferInsert;
export type Payment = typeof payments.$inferSelect;
export type NewPayment = typeof payments.$inferInsert;

