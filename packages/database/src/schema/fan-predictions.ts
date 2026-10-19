import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { matches } from "./matches";
import { tenants } from "./tenants";
import { users } from "./users";
/**
 * FAN-04 (Batch 164): member outcome picks. A PRIVATE, no-stakes pick per
 * fan per match: one row per (match, user), editable IN PLACE while the
 * prediction window is open (match still `scheduled` and kickoff not
 * passed). DELIBERATE SCHEMA DECISION: settled correctness is NOT stored -
 * it is derived at read time from the official match row (winnerId /
 * status), so a pick can never contradict or alter a recorded score, and a
 * postponed/rescheduled match needs no settle job. Short pick vocabulary
 * (home/away only) keeps the fold exhaustive; ties/voids read as "no
 * verdict" rather than a guessed wrongness.
 */
export const fanPredictions = pgTable(
  "fan_predictions",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    matchId: uuid("match_id").notNull().references(() => matches.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    prediction: text("prediction").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("fan_predictions_unique_per_user_key").on(table.matchId, table.userId),
    index("fan_predictions_tenant_match_idx").on(table.tenantId, table.matchId),
  ],
);
