import { pgTable, uuid, text, timestamp, index, integer } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants } from "./tenants";
import { users, userRoleEnum } from "./users";

/** Last recorded dispatch outcome. Provider acceptance is never delivery. */
export type InvitationEmailState = "unconfigured" | "provider_accepted" | "failed" | "unknown";

/**
 * Team-scoped role invitations.
 *
 * A league owner invites a team manager / coach / scorer by email. The invite
 * token is stored hashed (never plaintext); the recipient redeems it after
 * signing up, which provisions their `users` row and their tenant role.
 *
 * Status lifecycle: pending -> accepted | revoked | expired
 */
export const userInvites = pgTable(
  "user_invites",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    /** Role granted on redemption. */
    role: userRoleEnum("role").notNull().default("team_manager"),
    /** Optional team scope (team_manager / coach / scorer). */
    teamId: uuid("team_id"),
    /** SHA-256 of the single-use token; the plaintext is only emailed once. */
    tokenHash: text("token_hash").notNull(),
    status: text("status").notNull().default("pending"), // pending | accepted | revoked | expired
    invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    /** Last recorded dispatch outcome; tracks attempts without claiming delivery. */
    emailState: text("email_state").$type<InvitationEmailState>(),
    /** Instant of the last dispatch attempt; drives the resend cooldown. */
    emailAttemptedAt: timestamp("email_attempted_at", { withTimezone: true }),
    /** Number of dispatch attempts for this invitation (create + resends). */
    emailAttemptCount: integer("email_attempt_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    tenantIdx: index("idx_user_invites_tenant").on(table.tenantId, table.status),
    emailIdx: index("idx_user_invites_email").on(table.email),
  }),
);

export type UserInvite = typeof userInvites.$inferSelect;
export type NewUserInvite = typeof userInvites.$inferInsert;