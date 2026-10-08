export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { verifySuperAdmin } from "@/lib/admin-auth";
import { db, auditLogs, users } from "@mtk/database";
import { desc, eq } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const adminId = await verifySuperAdmin();
  if (!adminId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? 100), 500);
    const rows = await db
      .select({
        id: auditLogs.id,
        requestId: auditLogs.requestId,
        tenantId: auditLogs.tenantId,
        actorId: auditLogs.actorId,
        actorRole: auditLogs.actorRole,
        method: auditLogs.method,
        path: auditLogs.path,
        ip: auditLogs.ip,
        userAgent: auditLogs.userAgent,
        payload: auditLogs.payload,
        statusCode: auditLogs.statusCode,
        createdAt: auditLogs.createdAt,
        actorEmail: users.email,
      })
      .from(auditLogs)
      .leftJoin(users, eq(auditLogs.actorId, users.id))
      .orderBy(desc(auditLogs.createdAt))
      .limit(limit);

    return NextResponse.json({ logs: rows });
  } catch (error) {
    console.error("[admin-audit-logs] GET error:", error);
    return NextResponse.json({ error: "Failed to fetch audit logs" }, { status: 500 });
  }
}