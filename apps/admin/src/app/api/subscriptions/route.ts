/**
 * Admin Subscription Requests API — manage the payment approval queue.
 *
 * GET:  Lists subscription requests (optionally filtered by status).
 * PATCH: Approve or reject a subscription request.
 *        On approval: upgrades the tenant plan, creates subscription + payment rows.
 *        On rejection: records admin notes, plan stays unchanged.
 */

export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { verifySuperAdmin } from "@/lib/admin-auth";
import { db, subscriptionRequests, tenants, subscriptions, payments, users, commissionRates, invoices, notifications } from "@mtk/database";
import { eq, and, desc, sql } from "drizzle-orm";
import { z } from "zod";

/**
 * Issues a sequential invoice number and an invoice row for a settled payment.
 * Never throws: a numbering failure must not roll back a plan upgrade that has
 * already been granted to the customer.
 */
async function issueInvoice(input: {
  tenantId: string;
  userId: string | null;
  paymentId: string;
  subscriptionId: string | null;
  plan: string;
  amount: number;
  currency?: string;
  periodStart: Date;
  periodEnd: Date;
  description: string;
}): Promise<string | null> {
  try {
    const taxRate = Number(process.env.INVOICE_TAX_RATE ?? 0);
    const subtotal = input.amount;
    const taxAmount = Math.round(subtotal * taxRate) / 100;
    const total = subtotal + taxAmount;

    const [row] = await db
      .select({ invoiceNumber: sql<string>`next_invoice_number()` })
      .from(invoices)
      .limit(1);

    const invoiceNumber = row?.invoiceNumber;
    if (!invoiceNumber) throw new Error("invoice number unavailable");

    await db.insert(invoices).values({
      invoiceNumber,
      tenantId: input.tenantId,
      userId: input.userId,
      paymentId: input.paymentId,
      subscriptionId: input.subscriptionId,
      status: "paid",
      currency: input.currency ?? "PKR",
      subtotal: subtotal.toFixed(2),
      taxRate: taxRate.toFixed(2),
      taxAmount: taxAmount.toFixed(2),
      total: total.toFixed(2),
      amountPaid: subtotal.toFixed(2),
      description: input.description,
      plan: input.plan,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      paidAt: new Date(),
    });

    return invoiceNumber;
  } catch (error) {
    console.error("[admin-subscriptions] invoice issuance failed:", error);
    return null;
  }
}

/**
 * Standardized plan prices (PKR per league).
 */
const PLAN_PRICES: Record<string, number> = {
  free: 0,
  starter: 4999,
  pro: 14999,
  enterprise: 49999,
};

const approveRejectSchema = z.object({
  id: z.string().uuid(),
  action: z.enum(["approve", "reject"]),
  adminNotes: z.string().optional(),
});

export async function GET(req: NextRequest) {
  const adminId = await verifySuperAdmin();
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const status = req.nextUrl.searchParams.get("status");

    const conditions = [];
    if (status && status !== "all") {
      conditions.push(eq(subscriptionRequests.status, status as "pending" | "approved" | "rejected" | "expired"));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    // Fetch requests with tenant and user info
    const requests = await db
      .select({
        id: subscriptionRequests.id,
        tenantId: subscriptionRequests.tenantId,
        userId: subscriptionRequests.userId,
        requestedPlan: subscriptionRequests.requestedPlan,
        currentPlan: subscriptionRequests.currentPlan,
        amount: subscriptionRequests.amount,
        paymentMethod: subscriptionRequests.paymentMethod,
        paymentProofUrl: subscriptionRequests.paymentProofUrl,
        transactionReference: subscriptionRequests.transactionReference,
        status: subscriptionRequests.status,
        adminNotes: subscriptionRequests.adminNotes,
        reviewedBy: subscriptionRequests.reviewedBy,
        reviewedAt: subscriptionRequests.reviewedAt,
        expiresAt: subscriptionRequests.expiresAt,
        createdAt: subscriptionRequests.createdAt,
        // Joined data
        tenantName: tenants.name,
        tenantSlug: tenants.slug,
        userEmail: users.email,
        userDisplayName: users.displayName,
      })
      .from(subscriptionRequests)
      .leftJoin(tenants, eq(subscriptionRequests.tenantId, tenants.id))
      .leftJoin(users, eq(subscriptionRequests.userId, users.id))
      .where(whereClause)
      .orderBy(desc(subscriptionRequests.createdAt))
      .limit(100);

    return NextResponse.json({ requests });
  } catch (error) {
    console.error("[admin-subscriptions] GET error:", error);
    return NextResponse.json(
      { error: "Failed to fetch subscription requests" },
      { status: 500 }
    );
  }
}

export async function PATCH(req: NextRequest) {
  const adminId = await verifySuperAdmin();
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const validated = approveRejectSchema.safeParse(body);

    if (!validated.success) {
      return NextResponse.json(
        { error: "Validation failed", details: validated.error.flatten() },
        { status: 400 }
      );
    }

    const { id, action, adminNotes } = validated.data;

    // Find the request
    const [request] = await db
      .select()
      .from(subscriptionRequests)
      .where(eq(subscriptionRequests.id, id))
      .limit(1);

    if (!request) {
      return NextResponse.json({ error: "Request not found" }, { status: 404 });
    }

    if (request.status !== "pending") {
      return NextResponse.json(
        { error: `Request already ${request.status}. Cannot modify.` },
        { status: 409 }
      );
    }

    // Find the tenant
    const [tenant] = await db
      .select()
      .from(tenants)
      .where(eq(tenants.id, request.tenantId))
      .limit(1);

    if (!tenant) {
      return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
    }

    if (action === "reject") {
      // Reject: update status and add admin notes
      await db
        .update(subscriptionRequests)
        .set({
          status: "rejected",
          adminNotes: adminNotes || null,
          reviewedBy: adminId,
          reviewedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(subscriptionRequests.id, id));

      return NextResponse.json({ success: true, action: "rejected" });
    }

    // ─── Approve: full upgrade flow in a transaction-like sequence ───────

    // 1. Mark the request as approved
    await db
      .update(subscriptionRequests)
      .set({
        status: "approved",
        adminNotes: adminNotes || null,
        reviewedBy: adminId,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(subscriptionRequests.id, id));

    // 2. Upgrade the tenant plan
    await db
      .update(tenants)
      .set({
        plan: request.requestedPlan as "free" | "starter" | "pro" | "enterprise",
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, tenant.id));

    // 3. Create / update the subscription row
    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setMonth(periodEnd.getMonth() + 1);

    const amount = PLAN_PRICES[request.requestedPlan] || Number(request.amount);

    // Check if there's an active subscription for this tenant
    const [existingSub] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.tenantId, tenant.id))
      .limit(1);

    if (existingSub) {
      await db
        .update(subscriptions)
        .set({
          plan: request.requestedPlan,
          status: "active",
          monthlyAmount: String(amount),
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
          updatedAt: now,
        })
        .where(eq(subscriptions.id, existingSub.id));
    } else {
      await db.insert(subscriptions).values({
        tenantId: tenant.id,
        plan: request.requestedPlan,
        status: "active",
        monthlyAmount: String(amount),
        currency: "PKR",
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
      });
    }

    // 4. Create a payment record
    // Map the request's free-form payment_method onto the payments enum so a
    // Stripe payment isn't mislabelled as a bank transfer.
    const paymentMethod =
      request.paymentMethod === "stripe"
        ? "stripe"
        : request.paymentMethod === "jazzcash_manual" || request.paymentMethod === "jazzcash"
          ? "jazzcash"
          : request.paymentMethod === "easypaisa_manual" || request.paymentMethod === "easypaisa"
            ? "easypaisa"
            : "bank_transfer";
    // Look up commission rate for the plan
    const [commission] = await db
      .select()
      .from(commissionRates)
      .where(eq(commissionRates.plan, request.requestedPlan))
      .limit(1);

    const commissionRate = commission ? Number(commission.rate) : 0;
    const commissionAmount = amount * (commissionRate / 100);

    const [payment] = await db.insert(payments).values({
      tenantId: tenant.id,
      userId: request.userId,
      amount: String(amount),
      currency: "PKR",
      paymentMethod,
      status: "completed",
      transactionId: request.transactionReference,
      commissionAmount: String(commissionAmount),
      paidAt: now,
      completedAt: now,
      paymentType: "subscription",
      description: `Plan upgrade: ${request.currentPlan} → ${request.requestedPlan}`,
    }).returning();

    // 5. Issue the invoice for the settled payment
    const [activeSub] = await db
      .select({ id: subscriptions.id })
      .from(subscriptions)
      .where(eq(subscriptions.tenantId, tenant.id))
      .limit(1);

    const invoiceNumber = await issueInvoice({
      tenantId: tenant.id,
      userId: request.userId,
      paymentId: payment.id,
      subscriptionId: activeSub?.id ?? existingSub?.id ?? null,
      plan: request.requestedPlan,
      amount,
      periodStart: now,
      periodEnd,
      description: `SSL ${request.requestedPlan} subscription — ${now.toISOString().slice(0, 10)} to ${periodEnd.toISOString().slice(0, 10)}`,
    });

    // 6. Notify the league owner in-app so they see the invoice immediately
    await db.insert(notifications).values({
      tenantId: tenant.id,
      userId: request.userId,
      type: "billing_invoice_issued",
      channel: "in_app",
      title: "Payment confirmed",
      body: invoiceNumber
        ? `Invoice ${invoiceNumber} is ready.`
        : "Your plan has been activated.",
      data: { invoiceNumber },
      status: "delivered",
      deliveredAt: now,
    }).catch(() => undefined);

    return NextResponse.json({ success: true, action: "approved", invoiceNumber });
  } catch (error) {
    console.error("[admin-subscriptions] PATCH error:", error);
    return NextResponse.json(
      { error: "Failed to process subscription request" },
      { status: 500 }
    );
  }
}
