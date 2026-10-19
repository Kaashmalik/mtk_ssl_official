import { sql } from "drizzle-orm";
import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import { tournamentApplications } from "./tournament-applications";
import { users } from "./users";
/**
 * REG-03 (Batch 164): threaded replies under a tournament application.
 * Closes the needs_information conversation gap B147 documented (the
 * default answer path was withdraw + resubmit). The thread is a RECORD:
 * replies may attach only while the application is LIVE (terminal
 * applications read as locked history), author_side is server-derived from
 * verified authority (never client-asserted), and a reply NEVER mutates the
 * application's state machine - decisions remain the owner's audited moves.
 */
export const tournamentApplicationReplies = pgTable(
  "tournament_application_replies",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    applicationId: uuid("application_id").notNull().references(() => tournamentApplications.id, { onDelete: "cascade" }),
    authorId: uuid("author_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    authorSide: text("author_side").notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("tournament_application_replies_thread_idx").on(table.applicationId, table.createdAt),
  ],
);
