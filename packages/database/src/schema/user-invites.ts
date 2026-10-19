import { pgTable, uuid, text, timestamp, index, integer, unique } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants } from "./tenants";
import { users, userRoleEnum } from "./users";

/**
 * Last recorded dispatch outcome.
 *
 * `provider_accepted` means the provider accepted the send request — it is never
 * proof of delivery. `delivered`/`bounced`/`complained` are recorded only from a
 * signature-verified provider webhook.
 */
export type InvitationEmailState =
  | "queued"
  | "retry_scheduled"
  | "dead_lettered"
  | "unconfigured"
  | "provider_accepted"
  | "delivered"
  | "bounced"
  | "complained"
  | "failed"
  | "unknown";

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
    /** Instant the invitation link stops redeemable; independent of any membership bound. */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    /**
     * Optional membership expiry bound proposed by the issuing owner (SCORE-09).
     * Applied to the redeemed membership (with delegated_by_user_id provenance)
     * at acceptance; NULL proposes no bound and redemption leaves any existing
     * bound untouched. Distinct from the link expiry above.
     */
    membershipExpiresAt: timestamp("membership_expires_at", { withTimezone: true }),
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
    idTenantKey: unique("user_invites_id_tenant_key").on(table.id, table.tenantId),
  }),
);

export type UserInvite = typeof userInvites.$inferSelect;
export type NewUserInvite = typeof userInvites.$inferInsert;
