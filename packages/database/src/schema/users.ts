import { pgTable, uuid, text, timestamp, boolean, pgEnum } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * User role enum — Expanded for granular RBAC
 * - super_admin: Platform-wide access (MalikTech staff)
 * - league_owner: Manages their own league/tenant
 * - team_manager: Manages a specific team roster & registrations
 * - coach: Views team analytics, adds training notes
 * - scorer: Access to live scoring interface for assigned matches
 * - player: Views own stats, team info, schedule
 * - fan: Public access, can follow teams/players
 */
export const userRoleEnum = pgEnum("user_role", [
  "super_admin",
  "league_owner",
  "team_manager",
  "coach",
  "scorer",
  "player",
  "fan",
]);

/**
 * Users table — Multi-tenant users
 * Users can belong to multiple leagues (tenants) with different roles per tenant.
 */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  clerkId: text("clerk_id").unique(), // External auth provider ID
  email: text("email").notNull().unique(),
  displayName: text("display_name"),
  avatarUrl: text("avatar_url"),
  tenantIds: uuid("tenant_ids").array().notNull().default([]),
  role: userRoleEnum("role").notNull().default("fan"),
  isActive: boolean("is_active").default(true).notNull(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
