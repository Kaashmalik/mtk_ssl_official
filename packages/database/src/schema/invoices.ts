import { pgTable, uuid, text, timestamp, decimal, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants } from "./tenants";
import { payments } from "./subscriptions";
import { users } from "./users";

/**
 * Tax invoices / receipts issued when a subscription payment is approved.
 *
 * One row per settled payment (1:1 with `payments`). The number is a
 * human-readable sequential series (SSL-INV-YYYY-NNNNNN) assigned at
 * creation, so finance can reconcile against bank statements.
 */
export const invoices = pgTable(
  "invoices",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    invoiceNumber: text("invoice_number").notNull(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    /** Issued-to customer (league owner who paid). */
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    /** The settled payment this invoice bills. */
    paymentId: uuid("payment_id").references(() => payments.id, { onDelete: "set null" }),
    subscriptionId: uuid("subscription_id"),

    status: text("status").notNull().default("issued"), // draft | issued | paid | void
    currency: text("currency").notNull().default("PKR"),
    subtotal: decimal("subtotal", { precision: 12, scale: 2 }).notNull(),
    taxRate: decimal("tax_rate", { precision: 5, scale: 2 }).default("0"),
    taxAmount: decimal("tax_amount", { precision: 12, scale: 2 }).default("0"),
    total: decimal("total", { precision: 12, scale: 2 }).notNull(),
    amountPaid: decimal("amount_paid", { precision: 12, scale: 2 }).default("0"),

    description: text("description"),
    /** Snapshot of the plan sold, so later plan changes don't rewrite history. */
    plan: text("plan"),
    periodStart: timestamp("period_start", { withTimezone: true }),
    periodEnd: timestamp("period_end", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    numberIdx: index("idx_invoices_number").on(table.invoiceNumber),
    tenantIdx: index("idx_invoices_tenant").on(table.tenantId, table.createdAt),
  }),
);

export type Invoice = typeof invoices.$inferSelect;
export type NewInvoice = typeof invoices.$inferInsert;