export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { verifySuperAdmin } from "@/lib/admin-auth";
import { db, invoices, tenants } from "@mtk/database";
import { desc, eq } from "drizzle-orm";

/** GET /api/invoices — list issued invoices (tenant scoped or all). */
export async function GET(req: NextRequest) {
  const adminId = await verifySuperAdmin();
  if (!adminId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const tenantId = req.nextUrl.searchParams.get("tenantId");
    const rows = tenantId
      ? await db
          .select({
            id: invoices.id,
            invoiceNumber: invoices.invoiceNumber,
            tenantName: tenants.name,
            plan: invoices.plan,
            status: invoices.status,
            total: invoices.total,
            currency: invoices.currency,
            paidAt: invoices.paidAt,
            createdAt: invoices.createdAt,
          })
          .from(invoices)
          .leftJoin(tenants, eq(invoices.tenantId, tenants.id))
          .where(eq(invoices.tenantId, tenantId))
          .orderBy(desc(invoices.createdAt))
          .limit(200)
      : await db
          .select({
            id: invoices.id,
            invoiceNumber: invoices.invoiceNumber,
            tenantName: tenants.name,
            plan: invoices.plan,
            status: invoices.status,
            total: invoices.total,
            currency: invoices.currency,
            paidAt: invoices.paidAt,
            createdAt: invoices.createdAt,
          })
          .from(invoices)
          .leftJoin(tenants, eq(invoices.tenantId, tenants.id))
          .orderBy(desc(invoices.createdAt))
          .limit(200);

    return NextResponse.json({ invoices: rows });
  } catch (error) {
    console.error("[admin-invoices] GET error:", error);
    return NextResponse.json({ error: "Failed to fetch invoices" }, { status: 500 });
  }
}