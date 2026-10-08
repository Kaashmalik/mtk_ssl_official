import { pgTable, text, timestamp, uuid, jsonb } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey().default(sql`uuid_generate_v7()`),
  requestId: text("request_id").notNull(),
  tenantId: uuid("tenant_id"),
  actorId: uuid("actor_id"),
  actorRole: text("actor_role"),
  method: text("method").notNull(),
  path: text("path").notNull(),
  ip: text("ip"),
  userAgent: text("user_agent"),
  payload: jsonb("payload"),
  statusCode: text("status_code"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;