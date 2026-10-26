export const dynamic = 'force-dynamic';

import { NextResponse } from "next/server";
import { z } from "zod";
import { verifySuperAdmin } from "@/lib/admin-auth";
import { createTenantDeletionRequest } from "@/lib/admin-approvals";
import {
  db,
  users,
  adminActionApprovals,
  normalizeApprovalReason,
  ADMIN_APPROVAL_MIN_REASON_LENGTH,
} from "@mtk/database";
import { and, desc, eq, lte } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

// GET /api/admin-approvals - the two-person approval queue (the 100 most recent
// requests, newest first). Pending rows whose window lapsed are marked
// expired first so the queue never offers an action that can no longer run.
export async function GET() {
  const adminId = await verifySuperAdmin();
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await db
      .update(adminActionApprovals)
      .set({ status: "expired", updatedAt: new Date() })
      .where(and(eq(adminActionApprovals.status, "pending"), lte(adminActionApprovals.expiresAt, new Date())));

    const requester = alias(users, "requester");
    const decider = alias(users, "decider");
    const rows = await db
      .select({
        id: adminActionApprovals.id,
        action: adminActionApprovals.action,
        targetTenantId: adminActionApprovals.targetTenantId,
        targetLabel: adminActionApprovals.targetLabel,
        reason: adminActionApprovals.reason,
        status: adminActionApprovals.status,
        requestedBy: adminActionApprovals.requestedBy,
        requesterEmail: requester.email,
        decidedBy: adminActionApprovals.decidedBy,
        deciderEmail: decider.email,
        decidedAt: adminActionApprovals.decidedAt,
        decisionNote: adminActionApprovals.decisionNote,
        expiresAt: adminActionApprovals.expiresAt,
        createdAt: adminActionApprovals.createdAt,
      })
      .from(adminActionApprovals)
      .innerJoin(requester, eq(adminActionApprovals.requestedBy, requester.id))
      .leftJoin(decider, eq(adminActionApprovals.decidedBy, decider.id))
      .orderBy(desc(adminActionApprovals.createdAt))
      .limit(100);

    return NextResponse.json({
      viewerId: adminId,
      approvals: rows.map((row) => ({
        ...row,
        decidedAt: row.decidedAt?.toISOString() ?? null,
        expiresAt: row.expiresAt.toISOString(),
        createdAt: row.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    console.error("Error listing admin approvals:", error);
    return NextResponse.json({ error: "Failed to load approvals" }, { status: 500 });
  }
}

const requestSchema = z.object({
  action: z.literal("tenant.delete"),
  targetTenantId: z.string().uuid(),
  reason: z.unknown(),
});

// POST /api/admin-approvals - ask for a destructive action. Nothing runs here:
// a different super admin must approve it via /api/admin-approvals/[id].
export async function POST(request: Request) {
  const adminId = await verifySuperAdmin();
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const reason = normalizeApprovalReason(parsed.data.reason);
  if (!reason) {
    return NextResponse.json(
      { error: `Explain why in at least ${ADMIN_APPROVAL_MIN_REASON_LENGTH} characters.` },
      { status: 400 },
    );
  }

  return createTenantDeletionRequest({ adminId, tenantId: parsed.data.targetTenantId, reason, request });
}
