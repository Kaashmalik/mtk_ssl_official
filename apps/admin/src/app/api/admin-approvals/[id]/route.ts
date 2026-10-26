export const dynamic = 'force-dynamic';

import { NextResponse } from "next/server";
import { z } from "zod";
import { verifySuperAdmin } from "@/lib/admin-auth";
import { writeAuditLog } from "@/lib/audit-log";
import {
  db,
  tenants,
  adminActionApprovals,
  evaluateApprovalDecision,
  parseApprovalDecision,
} from "@mtk/database";
import { eq } from "drizzle-orm";

const bodySchema = z.object({
  decision: z.unknown(),
  note: z.string().trim().max(1000).optional().nullable(),
});

// POST /api/admin-approvals/[id] - approve, reject or cancel a pending request.
//
// The approver is the verified server identity, never request JSON. Approving
// runs the action in the SAME transaction that records the decision, under a
// row lock, so two admins deciding at once cannot both act and a failed
// deletion leaves the request pending instead of claiming it ran.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const adminId = await verifySuperAdmin();
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Approval not found" }, { status: 404 });
  }
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  const decision = parsed.success ? parseApprovalDecision(parsed.data.decision) : null;
  if (!parsed.success || !decision) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const note = parsed.data.note || null;

  try {
    const outcome = await db.transaction(async (tx) => {
      const [approval] = await tx
        .select()
        .from(adminActionApprovals)
        .where(eq(adminActionApprovals.id, id))
        .for("update")
        .limit(1);
      if (!approval) return { kind: "not-found" as const };

      const now = new Date();
      const verdict = evaluateApprovalDecision(approval, adminId, decision, now);
      if (!verdict.ok) {
        if (verdict.status === 410) {
          await tx
            .update(adminActionApprovals)
            .set({ status: "expired", updatedAt: now })
            .where(eq(adminActionApprovals.id, id));
        }
        return { kind: "refused" as const, verdict };
      }

      if (verdict.nextStatus === "executed" && approval.action === "tenant.delete") {
        // Cascades remove league-owned rows. This approval row has no FK to the
        // tenant, so the evidence of who asked and who approved survives.
        await tx.delete(tenants).where(eq(tenants.id, approval.targetTenantId));
      }

      await tx
        .update(adminActionApprovals)
        .set({ status: verdict.nextStatus, decidedBy: adminId, decidedAt: now, decisionNote: note, updatedAt: now })
        .where(eq(adminActionApprovals.id, id));

      return { kind: "decided" as const, approval, status: verdict.nextStatus };
    });

    if (outcome.kind === "not-found") {
      return NextResponse.json({ error: "Approval not found" }, { status: 404 });
    }
    if (outcome.kind === "refused") {
      return NextResponse.json({ error: outcome.verdict.error }, { status: outcome.verdict.status });
    }

    await writeAuditLog({
      method: "POST",
      path: `/api/admin-approvals/${id}`,
      actorId: adminId,
      actorRole: "super_admin",
      tenantId: outcome.status === "executed" ? undefined : outcome.approval.targetTenantId,
      payload: {
        action: `admin_approval.${outcome.status}`,
        approvalId: id,
        requestedAction: outcome.approval.action,
        targetTenantId: outcome.approval.targetTenantId,
        targetLabel: outcome.approval.targetLabel,
        requestedBy: outcome.approval.requestedBy,
        note,
      },
      statusCode: "200",
      request,
    });

    return NextResponse.json({ id, status: outcome.status });
  } catch (error) {
    console.error("Error deciding admin approval:", error);
    return NextResponse.json({ error: "Failed to record the decision" }, { status: 500 });
  }
}
