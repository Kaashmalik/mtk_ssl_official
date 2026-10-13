import { pgTable, uuid, text, timestamp, integer, uniqueIndex, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants } from "./tenants";
import { users, userRoleEnum } from "./users";

/**
 * Two-party league ownership transfer (IAM-07).
 *
 * Ownership of a league moves only through an explicit, mutually-consented
 * handover. The recorded owner (`tenants.owner_id`) initiates a transfer to an
 * active member of the same league, and that member must accept it before
 * anything changes. A stale, mistaken or abandoned request can therefore never
 * strand a league: nothing moves until the recipient consents.
 *
 * A completed transfer never leaves the league ownerless. Acceptance promotes
 * the recipient to `league_owner` in the same transaction that records the new
 * `tenants.owner_id` and demotes the previous owner to `demoted_role`, so there
 * is always at least one active owner.
 *
 * Status lifecycle: pending -> accepted | cancelled | expired
 */
export const ownershipTransfers = pgTable(
  "ownership_transfers",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    /** The current recorded owner who initiated the handover. */
    fromUserId: uuid("from_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** The active member who must accept before ownership moves. */
    toUserId: uuid("to_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** League role the outgoing owner keeps after acceptance. Never owner/platform. */
    demotedRole: userRoleEnum("demoted_role").notNull().default("team_manager"),
    status: text("status").$type<"pending" | "accepted" | "cancelled" | "expired">().notNull().default("pending"),
    /** Optimistic concurrency guard for the pending request (two-tab resolve). */
    version: integer("version").notNull().default(0),
    /** Pending requests lapse after this instant and must be re-issued. */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    /** The party who accepted, cancelled or triggered expiry. */
    resolvedBy: uuid("resolved_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    statusCheck: check(
      "ownership_transfers_status_check",
      sql`${table.status} IN ('pending', 'accepted', 'cancelled', 'expired')`,
    ),
    // A person cannot hand ownership to themselves.
    distinctCheck: check(
      "ownership_transfers_distinct_check",
      sql`${table.fromUserId} <> ${table.toUserId}`,
    ),
    versionCheck: check("ownership_transfers_version_check", sql`${table.version} >= 0`),
    // The outgoing owner may never keep owner/platform authority by demotion.
    demotedRoleCheck: check(
      "ownership_transfers_demoted_role_check",
      sql`${table.demotedRole} NOT IN ('league_owner', 'super_admin')`,
    ),
    // At most one open request per league; historical rows are unconstrained.
    pendingUnique: uniqueIndex("ownership_transfers_pending_key")
      .on(table.tenantId)
      .where(sql`${table.status} = 'pending'`),
    // Recipient inbox lookup ("do I have a pending transfer to accept?").
    recipientIdx: index("idx_ownership_transfers_recipient").on(table.toUserId, table.status),
  }),
);

export type OwnershipTransfer = typeof ownershipTransfers.$inferSelect;
export type NewOwnershipTransfer = typeof ownershipTransfers.$inferInsert;
