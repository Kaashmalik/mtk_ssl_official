import { pgTable, uuid, text, timestamp, boolean, pgEnum, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * User role enum — legacy carrier, remitted to PLATFORM roles by ISO-06.
 * - super_admin: Platform-wide access (MalikTech staff)
 * - fan: Public access, can follow teams/players
 * League roles (league_owner, team_manager, coach, scorer, player) remain in
 * the PG enum for data compatibility but are BLOCKED at this column by
 * users_role_platform_only and are authoritative only in user_tenant_roles.
 */
export const userRoleEnum = pgEnum("user_role", [
  "super_admin",
  "league_owner",
  "team_manager",
  "captain",
  "coach",
  "scorer",
  "player",
  "fan",
]);

/**
 * Users table — Multi-tenant users.
 * League membership (tenant + role + status + expiry) is authoritative in
 * user_tenant_roles; this table carries identity and the platform role only.
 */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  clerkId: text("clerk_id").unique(), // External auth provider ID
  email: text("email").notNull().unique(),
  displayName: text("display_name"),
  avatarUrl: text("avatar_url"),
  // ISO-06 (Batch 165): the LEGACY tenant_ids column is RETIRED - dropped by
  // migration 20261019160000. It was write-disabled first (B138) and has had
  // no reader for authorization since; the source wellness test
  // (iso06-retirement.test.ts) pins that no production source may reference
  // it. League membership lives exclusively in user_tenant_roles.
  // PLATFORM role only (super_admin | fan, enforced by users_role_platform_only).
  // League roles live exclusively in user_tenant_roles - this column is never
  // read for league authorization (ISO-06).
  role: userRoleEnum("role").notNull().default("fan"),
  isActive: boolean("is_active").default(true).notNull(),
  // PUB-03: affirmative cross-league career-linkage consent. Null = never
  // granted; a timestamp counts as granted until the person revokes it.
  // Gates only CROSS-LEAGUE merges (PUB-02 hub); per-league publication is
  // unchanged by it.
  publicCareerConsentAt: timestamp("public_career_consent_at", { withTimezone: true }),
  // UX-03: optional IANA display timezone (e.g. "Asia/Karachi"). Null =
  // unset; every display formatter falls back to an explicit UTC label and
  // never imputes the server's zone. Validated with isValidTimeZone at the
  // single write entry (account preferences).
  timeZone: text("time_zone"),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  // ISO-06 retirement: users.role is a platform-role carrier. League roles are
  // authoritative only in user_tenant_roles; this blocks legacy writers from
  // reintroducing league roles here. A super_admin row is platform staff.
  platformRoleCheck: check(
    "users_role_platform_only",
    sql`${table.role} IN ('super_admin', 'fan')`,
  ),
}));

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
