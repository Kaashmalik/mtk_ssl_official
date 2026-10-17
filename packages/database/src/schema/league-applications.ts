import { pgTable, uuid, text, timestamp, integer, uniqueIndex, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { LeagueApplicationState } from "../lib/league-application-policy";
import { tenants, tenantPlanEnum } from "./tenants";
import { users } from "./users";

/**
 * Platform league applications (REG-01).
 *
 * Today a league is created self-service (`createTenant`). For organizations
 * that need a reviewed onboarding, an account files *one* application here:
 * draft -> submitted -> platform review -> needs_information | approved |
 * rejected, with `withdrawn` available to the applicant at any non-terminal
 * point. The state machine itself lives in
 * `lib/league-application-policy.ts`; this table stores only the record.
 *
 * Provisioning safety (the "duplicate-provisioning safeguards"):
 *  - `league_applications_active_key` keeps at most one *active* application
 *    (draft/submitted/needs_information) per applicant, so double submission is
 *    impossible while a rejected or withdrawn application never blocks a fresh
 *    one.
 *  - `provisioned_tenant_id` is written exactly once, in the same transaction
 *    that flips the state to `approved` under the applicant's row lock and a
 *    version check (see the admin review route), so a retried approval can
 *    never create a second league.
 *
 * The desired plan is recorded for the platform's information. Approval
 * provisions a free-tier workspace; paid entitlements keep flowing through the
 * existing subscription/payment request flow.
 */
export const leagueApplications = pgTable(
  "league_applications",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    applicantId: uuid("applicant_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    proposedName: text("proposed_name").notNull(),
    proposedSlug: text("proposed_slug").notNull(),
    /** Plan the applicant asked for. Advisory input to the review, not an entitlement. */
    desiredPlan: tenantPlanEnum("desired_plan").notNull().default("free"),
    state: text("state").$type<LeagueApplicationState>().notNull().default("draft"),
    /** Optimistic concurrency guard (two-tab edits and stale review retries). */
    version: integer("version").notNull().default(0),
    /** Latest reviewer note: why information was requested or why it was rejected. */
    reviewReason: text("review_reason"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    /** Platform reviewer (super admin) who last decided on this application. */
    reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    /** The league created by approval. Written once; the provisioning receipt. */
    provisionedTenantId: uuid("provisioned_tenant_id").references(() => tenants.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    stateCheck: check(
      "league_applications_state_check",
      sql`${table.state} IN ('draft', 'submitted', 'needs_information', 'approved', 'rejected', 'withdrawn')`,
    ),
    versionCheck: check("league_applications_version_check", sql`${table.version} >= 0`),
    nameCheck: check(
      "league_applications_name_check",
      sql`char_length(${table.proposedName}) BETWEEN 2 AND 120`,
    ),
    // Same shape the applicant form and writers enforce before insert.
    slugCheck: check(
      "league_applications_slug_check",
      sql`${table.proposedSlug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`,
    ),
    // At most one active application per applicant; terminal rows are unconstrained.
    activeUnique: uniqueIndex("league_applications_active_key")
      .on(table.applicantId)
      .where(sql`${table.state} IN ('draft', 'submitted', 'needs_information')`),
    // A tenant may be the receipt of at most one application.
    provisionedUnique: uniqueIndex("league_applications_provisioned_key")
      .on(table.provisionedTenantId)
      .where(sql`${table.provisionedTenantId} IS NOT NULL`),
    // Platform review queue lookup (oldest first within a state).
    queueIdx: index("idx_league_applications_queue").on(table.state, table.createdAt),
  }),
);

export type LeagueApplication = typeof leagueApplications.$inferSelect;
export type NewLeagueApplication = typeof leagueApplications.$inferInsert;
