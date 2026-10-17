import { pgTable, text, timestamp, boolean, uuid, pgEnum } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Tenant plan enum
 */
export const tenantPlanEnum = pgEnum("tenant_plan", ["free", "starter", "pro", "enterprise"]);

/**
 * Tenants table - Multi-tenant architecture
 * Each league is a tenant with isolated data via RLS policies
 */
/**
 * PUB-02 hub listing enum: the league's own publication approval.
 * Default 'unlisted' — existing leagues are never surfaced cross-league.
 */
export const hubListingStatusEnum = pgEnum("hub_listing_status", ["unlisted", "listed"]);

/**
 * Tenants table - Multi-tenant architecture
 * Each league is a tenant with isolated data via RLS policies
 */
export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  customDomain: text("custom_domain").unique(),
  customDomainVerified: boolean("custom_domain_verified").default(false).notNull(),
  customDomainVerifiedAt: timestamp("custom_domain_verified_at", { withTimezone: true }),
  sslEnabled: boolean("ssl_enabled").default(false).notNull(),
  emailDomainVerified: boolean("email_domain_verified").default(false).notNull(),
  ownerId: uuid("owner_id").notNull(), // References auth.users
  plan: tenantPlanEnum("plan").notNull().default("free"),
  hubListingStatus: hubListingStatusEnum("hub_listing_status").notNull().default("unlisted"),
  /** When the league was last explicitly listed; the hub policy fails closed without it. */
  hubListedAt: timestamp("hub_listed_at", { withTimezone: true }),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;

