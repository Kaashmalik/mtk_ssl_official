import { NextResponse } from "next/server";
import { writeAuditLog } from "@/lib/audit-log";
import { db, tenants, adminActionApprovals, approvalExpiry, isUniqueViolation } from "@mtk/database";
import { eq } from "drizzle-orm";

/**
 * Record a pending two-person request to delete a league. Nothing is deleted
 * here: a different super admin must approve via /api/admin-approvals/[id].
 * Shared by POST /api/admin-approvals and DELETE /api/tenants/[id].
 */
export async function createTenantDeletionRequest(opts: {
  adminId: string;
  tenantId: string;
  reason: string;
  request: Request;
}) {
  try {
    const [tenant] = await db
      .select({ id: tenants.id, name: tenants.name })
      .from(tenants)
      .where(eq(tenants.id, opts.tenantId))
      .limit(1);
    if (!tenant) {
      return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
    }

    const [created] = await db
      .insert(adminActionApprovals)
      .values({
        action: "tenant.delete",
        targetTenantId: tenant.id,
        targetLabel: tenant.name,
        reason: opts.reason,
        requestedBy: opts.adminId,
        expiresAt: approvalExpiry(new Date()),
      })
      .returning({ id: adminActionApprovals.id, expiresAt: adminActionApprovals.expiresAt });

    await writeAuditLog({
      method: "POST",
      path: "/api/admin-approvals",
      actorId: opts.adminId,
      actorRole: "super_admin",
      tenantId: tenant.id,
      payload: { action: "admin_approval.requested", approvalId: created.id, requestedAction: "tenant.delete", reason: opts.reason },
      statusCode: "202",
      request: opts.request,
    });

    return NextResponse.json(
      {
        approvalId: created.id,
        status: "pending",
        expiresAt: created.expiresAt.toISOString(),
        message: "Deletion requested. A second super admin must approve it before anything is deleted.",
      },
      { status: 202 },
    );
  } catch (error) {
    if (isUniqueViolation(error)) {
      return NextResponse.json(
        { error: "A deletion request for this league is already waiting for approval." },
        { status: 409 },
      );
    }
    console.error("Error creating admin approval:", error);
    return NextResponse.json({ error: "Failed to request approval" }, { status: 500 });
  }
}
