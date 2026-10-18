import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { teams } from "./teams";
import { tournaments } from "./tournaments";
import { tenants } from "./tenants";
import { users } from "./users";
/**
 * REG-03 (Batch 147): team applications to a tournament. A REVIEWED state
 * machine, not a form: submitted -> needs_information | waitlisted ->
 * approved | declined, with member-side withdrawal of any live
 * application. "One LIVE application per team per tournament" is a
 * database guarantee (partial unique on the live states); owner decisions
 * carry fixed-vocabulary provenance (decider + time required by the
 * resolution CHECK; a withdrawal resolves with a time but no decider -
 * the MEMBER resolved it). needs_information is a QUESTION, not a
 * rejection: the documented default answer path is withdraw + resubmit.
 */
export const tournamentApplications = pgTable(
  "tournament_applications",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    tournamentId: uuid("tournament_id").notNull().references(() => tournaments.id, { onDelete: "cascade" }),
    teamId: uuid("team_id").notNull().references(() => teams.id, { onDelete: "cascade" }),
    submittedBy: uuid("submitted_by").notNull().references(() => users.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("submitted"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
  },
  (table) => [
    // Live = submitted | needs_information | waitlisted (member-actionable
    // states); approved | declined | withdrawn are terminal. Mirrors the
    // migration's partial unique.
    uniqueIndex("tournament_applications_one_live_per_team_key")
      .on(table.tournamentId, table.teamId)
      .where(sql`status IN ('submitted', 'needs_information', 'waitlisted')`),
    index("tournament_applications_open_tournament_idx")
      .on(table.tournamentId, table.createdAt)
      .where(sql`status IN ('submitted', 'needs_information', 'waitlisted')`),
    index("tournament_applications_team_history_idx").on(table.teamId, table.createdAt),
  ],
);
