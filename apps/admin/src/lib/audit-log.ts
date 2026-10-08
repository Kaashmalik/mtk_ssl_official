import { db, auditLogs } from "@mtk/database";
import { randomUUID } from "node:crypto";

/**
 * Append an entry to the shared audit_logs table.
 *
 * Every privileged admin action (impersonation, commission changes, feature-flag
 * toggles, white-label approvals, etc.) MUST call this function. It acts as the
 * platform's tamper-evident log.
 *
 * The table lives outside tenant-scoped RLS on purpose: audit integrity must not
 * depend on the caller's tenant context.
 */
export async function writeAuditLog(opts: {
  method: string;
  path: string;
  actorId: string;
  actorRole?: string;
  tenantId?: string;
  payload?: Record<string, unknown>;
  statusCode?: string;
  request?: Request;
}) {
  const requestId = randomUUID();
  const ip = opts.request?.headers.get("x-forwarded-for") ?? opts.request?.headers.get("x-real-ip") ?? null;
  const userAgent = opts.request?.headers.get("user-agent") ?? null;

  await db.insert(auditLogs).values({
    requestId,
    method: opts.method,
    path: opts.path,
    actorId: opts.actorId,
    actorRole: opts.actorRole ?? null,
    tenantId: opts.tenantId ?? null,
    ip,
    userAgent,
    payload: opts.payload ?? null,
    statusCode: opts.statusCode ?? null,
  });
}
