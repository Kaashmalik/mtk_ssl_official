import { pgTable, uuid, text, timestamp, integer } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * Verification tokens for OTP (registration, password reset, renewal, admin 2FA).
 * Codes are stored as HMAC-SHA256 hashes — never plaintext.
 */
export const verificationTokens = pgTable("verification_tokens", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  identifier: text("identifier").notNull(), // phone (E.164) or email
  tokenHash: text("token_hash").notNull(),
  channel: text("channel").notNull(), // 'whatsapp' | 'sms' | 'email'
  purpose: text("purpose").notNull(), // 'registration' | 'password_reset' | 'renewal_confirm' | 'super_admin_2fa'
  attempts: integer("attempts").default(0).notNull(),
  maxAttempts: integer("max_attempts").default(5).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type VerificationToken = typeof verificationTokens.$inferSelect;
export type NewVerificationToken = typeof verificationTokens.$inferInsert;
