import { pgTable, uuid, text, timestamp, uniqueIndex, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users";

/**
 * Two-person approval for destructive platform-admin actions.
 *
 * The super admin who requests a destructive action never executes it: a
 * DIFFERENT active super admin must approve first. Requests lapse after
 * `expiresAt` and must be re-issued.
 *
 * `targetTenantId` intentionally has no foreign key, and `targetLabel`
 * snapshots the league name: this row is the evidence trail for a deletion and
 * must survive the deletion of its target.
 *
 * Status lifecycle: pending -> executed | rejected | cancelled | expired
 */
export const adminActionApprovals = pgTable(
  "admin_action_approvals",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    action: text("action").$type<AdminApprovalAction>().notNull(),
    targetTenantId: uuid("target_tenant_id").notNull(),
    targetLabel: text("target_label").notNull(),
    reason: text("reason").notNull(),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    status: text("status").$type<AdminApprovalStatus>().notNull().default("pending"),
    decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "restrict" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    actionCheck: check("admin_action_approvals_action_check", sql`${table.action} IN ('tenant.delete')`),
    statusCheck: check(
      "admin_action_approvals_status_check",
      sql`${table.status} IN ('pending', 'executed', 'rejected', 'cancelled', 'expired')`,
    ),
    // The requester can never be the approver of an executed action.
    secondPersonCheck: check(
      "admin_action_approvals_second_person_check",
      sql`${table.status} <> 'executed' OR (${table.decidedBy} IS NOT NULL AND ${table.decidedBy} <> ${table.requestedBy})`,
    ),
    reasonCheck: check("admin_action_approvals_reason_check", sql`char_length(btrim(${table.reason})) >= 10`),
    // At most one open request per action and target.
    pendingUnique: uniqueIndex("admin_action_approvals_pending_key")
      .on(table.action, table.targetTenantId)
      .where(sql`${table.status} = 'pending'`),
    statusIdx: index("idx_admin_action_approvals_status").on(table.status, table.createdAt),
  }),
);

export type AdminApprovalAction = "tenant.delete";
export type AdminApprovalStatus = "pending" | "executed" | "rejected" | "cancelled" | "expired";
export type AdminActionApproval = typeof adminActionApprovals.$inferSelect;
export type NewAdminActionApproval = typeof adminActionApprovals.$inferInsert;
