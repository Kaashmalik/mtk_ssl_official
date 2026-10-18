import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { matches } from "./matches";
import { tenants } from "./tenants";
import { users } from "./users";

/**
 * REG-05 (Batch 138): member-recorded per-match availability. One row per
 * (match, user), updated in place with provenance - re-answering never
 * deletes, so planning views keep the last recorded answer. The person is
 * the authenticated league member; roster identity mapping stays with the
 * roster/registration flows.
 */
export const matchAvailability = pgTable(
  "match_availability",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    matchId: uuid("match_id").notNull().references(() => matches.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("available"),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("match_availability_match_user_uq").on(table.matchId, table.userId),
    index("match_availability_tenant_idx").on(table.tenantId),
  ],
);
