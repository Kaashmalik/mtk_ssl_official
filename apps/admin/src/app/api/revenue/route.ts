export const dynamic = 'force-dynamic';

import { NextResponse } from "next/server";
import { verifySuperAdmin } from "@/lib/admin-auth";
import { db, tenants, payments } from "@mtk/database";
import { eq, and, gte, desc } from "drizzle-orm";

/**
 * Standardized plan prices (PKR per league) — must match tenant_plan enum
 * and the marketing pricing component.
 */
const PLAN_PRICES: Record<string, number> = {
  free: 0,
  starter: 4999,
  pro: 14999,
  enterprise: 49999,
};

export async function GET() {
  const adminId = await verifySuperAdmin();
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Get real tenant counts from DB
    const tenantsList = await db
      .select({
        id: tenants.id,
        plan: tenants.plan,
        isActive: tenants.isActive,
        createdAt: tenants.createdAt,
      })
      .from(tenants);

    const activeTenants = tenantsList.filter((t) => t.isActive);

    // Calculate MRR based on actual plan prices
    const mrr = activeTenants.reduce(
      (sum, t) => sum + (PLAN_PRICES[t.plan] || 0),
      0
    );
    const arr = mrr * 12;

    // Revenue by plan breakdown
    const revenueByPlan = activeTenants.reduce(
      (acc: Record<string, number>, t) => {
        const plan = t.plan || "free";
        acc[plan] = (acc[plan] || 0) + (PLAN_PRICES[plan] || 0);
        return acc;
      },
      {} as Record<string, number>
    );

    // Fetch recent completed payments (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const recentPayments = await db
      .select({
        id: payments.id,
        tenantId: payments.tenantId,
        amount: payments.amount,
        paymentMethod: payments.paymentMethod,
        status: payments.status,
        paymentType: payments.paymentType,
        completedAt: payments.completedAt,
        createdAt: payments.createdAt,
      })
      .from(payments)
      .where(
        and(
          eq(payments.status, "completed"),
          gte(payments.completedAt, thirtyDaysAgo)
        )
      )
      .orderBy(desc(payments.completedAt))
      .limit(20);

    return NextResponse.json({
      mrr,
      arr,
      totalRevenue: arr,
      churnRate: 0,
      activeSubscriptions: activeTenants.length,
      totalTenants: tenantsList.length,
      revenueByPlan,
      recentPayments,
    });
  } catch (error) {
    console.error("Revenue API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch revenue data" },
      { status: 500 }
    );
  }
}
