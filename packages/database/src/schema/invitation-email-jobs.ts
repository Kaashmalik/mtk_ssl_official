import { pgTable, uuid, text, integer, timestamp, index, unique, foreignKey } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenants } from "./tenants";
import { userInvites } from "./user-invites";

export const invitationEmailJobs = pgTable("invitation_email_jobs", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  inviteId: uuid("invite_id").notNull(),
  tokenHash: text("token_hash").notNull(),
  encryptedMessage: text("encrypted_message"),
  keyId: text("key_id").notNull(),
  state: text("state").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
  leaseToken: uuid("lease_token"),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
}, table => [
  unique("invitation_email_jobs_invite_token_key").on(table.inviteId, table.tokenHash),
  foreignKey({ name: "invitation_email_jobs_invite_tenant_fk", columns: [table.inviteId, table.tenantId], foreignColumns: [userInvites.id, userInvites.tenantId] }).onDelete("cascade"),
  index("invitation_email_jobs_tenant_idx").on(table.tenantId, table.inviteId),
  index("invitation_email_jobs_due_idx").on(table.nextAttemptAt, table.id).where(sql`${table.state} IN ('pending','leased')`),
]);
