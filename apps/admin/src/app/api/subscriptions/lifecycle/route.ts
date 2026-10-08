/**
 * Admin Subscription Lifecycle API — list active subscriptions with
 * derived status/countdown, extend periods, and override plan tiers.
 */

export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { verifySuperAdmin } from "@/lib/admin-auth";
import { db, subscriptions, tenants, auditLogs } from "@mtk/database";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";

function derive(currentPeriodEnd: Date | null, trialEndsAt: Date | null, status: string) {
  const now = Date.now();
  if (status === "trialing" || (trialEndsAt && trialEndsAt.getTime() > now)) {
    const end = trialEndsAt ? trialEndsAt.getTime() : now;
    return { state: "trialing", daysLeft: Math.ceil((end - now) / 86400000) };
  }
  if (status === "canceled" || status === "paused") return { state: "expired", daysLeft: 0 };
  if (!currentPeriodEnd) return { state: "active", daysLeft: null as number | null };
  const days = (currentPeriodEnd.getTime() - now) / 86400000;
  if (days > 7) return { state: "active", daysLeft: Math.floor(days) };
  if (days > 1) return { state: "expiring", daysLeft: Math.floor(days) };
  if (days >= 0) return { state: "critical", daysLeft: Math.max(0, Math.floor(days)) };
  if (days >= -7) return { state: "grace", daysLeft: Math.floor(days + 7) };
  return { state: "expired", daysLeft: Math.floor(days) };
}

export async function GET() {
  const adminId = await verifySuperAdmin();
  if (!adminId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const rows = await db
      .select({
        id: subscriptions.id,
        tenantId: subscriptions.tenantId,
        plan: subscriptions.plan,
        status: subscriptions.status,
        monthlyAmount: subscriptions.monthlyAmount,
        currency: subscriptions.currency,
        currentPeriodStart: subscriptions.currentPeriodStart,
        currentPeriodEnd: subscriptions.currentPeriodEnd,
        trialEndsAt: subscriptions.trialEndsAt,
        cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd,
        createdAt: subscriptions.createdAt,
        tenantName: tenants.name,
        tenantSlug: tenants.slug,
        tenantPlan: tenants.plan,
      })
      .from(subscriptions)
      .leftJoin(tenants, eq(subscriptions.tenantId, tenants.id))
      .orderBy(desc(subscriptions.createdAt))
      .limit(200);

    return NextResponse.json({
      subscriptions: rows.map((r) => ({ ...r, ...derive(r.currentPeriodEnd, r.trialEndsAt, r.status) })),
    });
  } catch (error) {
    console.error("[admin-subscription-lifecycle] GET error:", error);
    return NextResponse.json({ error: "Failed to fetch subscriptions" }, { status: 500 });
  }
}

const patchSchema = z.object({
  id: z.string().uuid(),
  action: z.enum(["extend_days", "set_plan", "reactivate"]),
  days: z.number().int().min(1).max(3650).optional(),
  plan: z.enum(["free", "starter", "pro", "enterprise"]).optional(),
  reason: z.string().max(500).optional(),
});

export async function PATCH(req: NextRequest) {
  const adminId = await verifySuperAdmin();
  if (!adminId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const parsed = patchSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 400 });
    }
    const { id, action, days, plan, reason } = parsed.data;

    const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.id, id)).limit(1);
    if (!sub) return NextResponse.json({ error: "Subscription not found" }, { status: 404 });

    const now = new Date();
    const update: Partial<typeof subscriptions.$inferInsert> = { updatedAt: now };

    if (action === "extend_days") {
      const base = sub.currentPeriodEnd && sub.currentPeriodEnd > now ? sub.currentPeriodEnd : now;
      const next = new Date(base);
      next.setDate(next.getDate() + (days ?? 30));
      update.currentPeriodEnd = next;
      if (sub.status === "past_due" || sub.status === "paused" || sub.status === "canceled") {
        update.status = "active";
      }
    } else if (action === "set_plan") {
      if (!plan) return NextResponse.json({ error: "plan is required" }, { status: 400 });
      update.plan = plan;
      await db.update(tenants).set({ plan, updatedAt: now }).where(eq(tenants.id, sub.tenantId));
    } else if (action === "reactivate") {
      const next = new Date(now);
      next.setMonth(next.getMonth() + 1);
      update.status = "active";
      update.currentPeriodStart = now;
      update.currentPeriodEnd = next;
    }

    const [updated] = await db.update(subscriptions).set(update).where(eq(subscriptions.id, id)).returning();

    await db.insert(auditLogs).values({
      requestId: crypto.randomUUID(),
      actorId: adminId,
      actorRole: "super_admin",
      method: "PATCH",
      path: "/api/subscriptions/lifecycle",
      payload: { action, subscriptionId: id, days, plan, reason: reason ?? null },
      statusCode: "200",
    });

    return NextResponse.json({ subscription: updated });
  } catch (error) {
    console.error("[admin-subscription-lifecycle] PATCH error:", error);
    return NextResponse.json({ error: "Failed to update subscription" }, { status: 500 });
  }
}