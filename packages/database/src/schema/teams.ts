import { pgTable, uuid, text, timestamp, boolean, integer } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants } from "./tenants";
import { tournaments } from "./tournaments";
import { users } from "./users";

/**
 * Teams table — Enhanced with branding, roster limits, and metadata
 */
export const teams = pgTable("teams", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  tournamentId: uuid("tournament_id").references(() => tournaments.id, { onDelete: "set null" }),

  // Identity
  name: text("name").notNull(),
  shortName: text("short_name"),
  slug: text("slug").notNull(),
  description: text("description"),
  city: text("city"),

  // Branding
  logoUrl: text("logo_url"),
  bannerUrl: text("banner_url"),
  primaryColor: text("primary_color"),   // Hex e.g. #1a2b3c
  secondaryColor: text("secondary_color"),

  // Management
  captainId: uuid("captain_id").references(() => users.id, { onDelete: "set null" }),
  managerId: uuid("manager_id").references(() => users.id, { onDelete: "set null" }),

  // Settings
  jerseyColor: text("jersey_color"),
  homeGround: text("home_ground"),
  foundedYear: integer("founded_year"),
  maxSquadSize: integer("max_squad_size").default(15),

  // Status
  isActive: boolean("is_active").default(true).notNull(),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  uniqueTenantSlug: sql`UNIQUE (${table.tenantId}, ${table.slug})`,
}));

export type Team = typeof teams.$inferSelect;
export type NewTeam = typeof teams.$inferInsert;
