import { pgTable, text, timestamp, uuid, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Impersonation sessions — single-use, audited, revocable.
 *
 * Lifecycle: issued -> active -> (revoked | expired)
 *
 * Security invariants enforced at the DB layer:
 *  - A `jti` may only be `active` for one row at a time (partial unique index).
 *  - `expires_at` is a hard ceiling regardless of token signature validity.
 *
 * This table is written only by super-admin server code and is deliberately
 * NOT covered by tenant-scoped RLS — see migration 018.
 */
export const impersonationSessions = pgTable(
  "impersonation_sessions",
  {
    id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
    jti: text("jti").notNull(),
    adminUserId: text("admin_user_id").notNull(),
    adminEmail: text("admin_email").notNull(),
    targetUserId: uuid("target_user_id").notNull(),
    targetEmail: text("target_email").notNull(),
    status: text("status").notNull().default("issued"),
    issuedAt: timestamp("issued_at", { withTimezone: true }).defaultNow().notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    issuedFromIp: text("issued_from_ip"),
    userAgent: text("user_agent"),
    reason: text("reason"),
  },
  (table) => [
    uniqueIndex("impersonation_active_jti_uniq")
      .on(table.jti)
      .where(sql`status = 'active'`),
    index("idx_impersonation_admin").on(table.adminUserId, table.issuedAt),
    index("idx_impersonation_target").on(table.targetUserId, table.issuedAt),
    index("idx_impersonation_expires").on(table.expiresAt),
  ]
);

export type ImpersonationSession = typeof impersonationSessions.$inferSelect;
export type NewImpersonationSession = typeof impersonationSessions.$inferInsert;
