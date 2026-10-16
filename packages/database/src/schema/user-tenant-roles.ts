import { pgTable, uuid, boolean, timestamp, uniqueIndex, index, text, integer, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users, userRoleEnum } from "./users";
import { tenants } from "./tenants";

/**
 * User-Tenant Roles junction table.
 *
 * Replaces the single `users.role` + `users.tenant_ids` design.
 * Each row maps one user to one tenant with a specific role.
 *
 * A user who is a `league_owner` in Tenant A and a `scorer` in Tenant B
 * will have two rows here.
 */
export const userTenantRoles = pgTable(
  "user_tenant_roles",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    role: userRoleEnum("role").notNull().default("fan"),
    /** League-only access; never mirrors or changes users.isActive. */
    status: text("status").$type<"active" | "suspended">().notNull().default("active"),
    /**
     * Bounded access (SCORE-09): when set, the membership stops granting access
     * once this instant passes. Cleared (null) means no expiry. Enforcement is
     * fail-closed at the canonical write boundary and through the shared
     * membership-effectiveness policy.
     */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    /** Owner who granted or last extended this bounded membership; provenance only. */
    delegatedByUserId: uuid("delegated_by_user_id").references(() => users.id, { onDelete: "set null" }),
    /** Incremented by the database trigger on every update, including invites. */
    version: integer("version").notNull().default(0),
    /** True if this is the user's primary/default tenant */
    isPrimary: boolean("is_primary").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    // One role per (user, tenant). `rbac-server.getUserRoleForTenant` filters on
    // (userId, tenantId) and reads a single `role` with `.limit(1)`, so
    // duplicates would make the effective permission non-deterministic.
    // Added in migration 20261004210000_create_user_tenant_roles.sql.
    userTenantUniq: uniqueIndex("user_tenant_roles_user_tenant_key").on(
      table.userId,
      table.tenantId,
    ),
    // Tenant-wide lookups filter on tenant_id alone.
    tenantIdx: index("idx_user_tenant_roles_tenant_id").on(table.tenantId),
    // Bounded-membership sweeps/admin reads by league; advisory, not enforcement.
    expiresIdx: index("idx_user_tenant_roles_expires_at")
      .on(table.tenantId).where(sql`${table.expiresAt} IS NOT NULL`),
    statusCheck: check("user_tenant_roles_status_check", sql`${table.status} IN ('active', 'suspended')`),
    versionCheck: check("user_tenant_roles_version_check", sql`${table.version} >= 0`),
    // A bounded membership must expire after it began; the clock is the row's own creation.
    expiryCheck: check("user_tenant_roles_expiry_check",
      sql`${table.expiresAt} IS NULL OR ${table.expiresAt} > ${table.createdAt}`),
  }),
);

export type UserTenantRole = typeof userTenantRoles.$inferSelect;
export type NewUserTenantRole = typeof userTenantRoles.$inferInsert;
