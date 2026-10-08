import { pgTable, uuid, boolean, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
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
  }),
);

export type UserTenantRole = typeof userTenantRoles.$inferSelect;
export type NewUserTenantRole = typeof userTenantRoles.$inferInsert;
