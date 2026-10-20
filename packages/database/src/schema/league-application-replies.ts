import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { leagueApplications } from "./league-applications";
import { users } from "./users";

/**
 * ENH-02-02: persisted applicant replies under a league application's
 * information request. Deliberately its OWN table — not a reuse of the
 * tournament application replies (REG-03): league onboarding is platform
 * level (no tenant scope), the single author side is "applicant", and the
 * thread opens only while the application carries `needs_information`. A
 * reply is an additive record: it never mutates the application's state
 * machine, version, or review reason.
 */
export const leagueApplicationReplies = pgTable(
  "league_application_replies",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => leagueApplications.id, { onDelete: "cascade" }),
    authorId: uuid("author_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    authorSide: text("author_side").notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("league_application_replies_thread_idx").on(table.applicationId, table.createdAt),
  ],
);
