import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { db, subscriptionRequests, tenants, subscriptions, payments } from "@mtk/database";
import { and, eq } from "drizzle-orm";
import { PLAN_PRICES } from "@mtk/database/lib/plan-limits";

export const dynamic = "force-dynamic";

/**
 * POST /api/webhooks/stripe
 *
 * Settles a subscription_request once payment succeeds, so an international
 * tenant activates without a human approval step. Signature is verified with
 * STRIPE_WEBHOOK_SECRET; the raw body is required for that.
 */
export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  const body = await request.text();

  if (!secret) {
    return NextResponse.json({ error: "Stripe webhook not configured" }, { status: 501 });
  }

  // --- signature verification (Stripe scheme: t=...,v1=...) ---
  const header = request.headers.get("stripe-signature") ?? "";
  const parts = header.split(",").map((p) => p.split("="));
  const timestamp = parts.find(([k]) => k === "t")?.[1];
  const signatures = parts.filter(([k]) => k === "v1").map(([, v]) => v);

  if (!timestamp || signatures.length === 0) {
    return NextResponse.json({ error: "Missing stripe-signature header" }, { status: 400 });
  }

  // Reject replays older than 5 minutes.
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > 300) {
    return NextResponse.json({ error: "Timestamp outside tolerance" }, { status: 400 });
  }

  const expected = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  const ok = signatures.some((sig) => {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  });
  if (!ok) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  // --- handle the event ---
  let event: {
    type: string;
    data: {
      object: {
        id?: string;
        client_reference_id?: string | null;
        metadata?: Record<string, string>;
        amount_total?: number;
        currency?: string;
        payment_status?: string;
      };
    };
  };
  try {
    event = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const requestId = session.metadata?.requestId ?? session.client_reference_id ?? null;

      if (requestId && session.payment_status === "paid") {
        await db.transaction(async (tx) => {
          const [request] = await tx.select().from(subscriptionRequests)
            .where(eq(subscriptionRequests.id, requestId)).for("update").limit(1);
          if (!request || request.status !== "pending") return;

          const now = new Date();
          if (request.expiresAt <= now) {
            await tx.update(subscriptionRequests).set({ status: "expired", updatedAt: now })
              .where(and(eq(subscriptionRequests.id, request.id), eq(subscriptionRequests.status, "pending")));
            return;
          }

          const plan = request.requestedPlan as keyof typeof PLAN_PRICES;
          const monthlyAmount = PLAN_PRICES[plan];
          if (!monthlyAmount) throw new Error("Stripe request has an unknown plan");
          const billedAmount = session.amount_total === undefined ? Number(request.amount) : session.amount_total / 100;
          if (billedAmount !== Number(request.amount)) throw new Error("Stripe amount does not match subscription request");
          const periodMonths = billedAmount === monthlyAmount * 10 ? 12 : billedAmount === monthlyAmount ? 1 : 0;
          if (!periodMonths) throw new Error("Stripe amount is not a valid monthly or annual plan price");
          const periodEnd = new Date(now);
          const day = periodEnd.getDate();
          periodEnd.setDate(1);
          periodEnd.setMonth(periodEnd.getMonth() + periodMonths);
          periodEnd.setDate(Math.min(day, new Date(periodEnd.getFullYear(), periodEnd.getMonth() + 1, 0).getDate()));

          const [claimed] = await tx.update(subscriptionRequests).set({
            status: "approved",
            transactionReference: session.id ?? `stripe_${Date.now()}`,
            reviewedAt: now,
            updatedAt: now,
            adminNotes: "Auto-approved via verified Stripe webhook",
          }).where(and(
            eq(subscriptionRequests.id, request.id),
            eq(subscriptionRequests.status, "pending"),
          )).returning({ id: subscriptionRequests.id });
          if (!claimed) return;

          await tx.update(tenants).set({ plan, updatedAt: now })
            .where(eq(tenants.id, request.tenantId));
          const [existingSub] = await tx.select().from(subscriptions)
            .where(eq(subscriptions.tenantId, request.tenantId)).limit(1);
          const subscriptionValues = {
            plan,
            status: "active" as const,
            monthlyAmount: String(monthlyAmount),
            currency: (session.currency ?? "pkr").toUpperCase(),
            paymentMethod: "stripe" as const,
            currentPeriodStart: now,
            currentPeriodEnd: periodEnd,
            updatedAt: now,
          };
          if (existingSub) {
            await tx.update(subscriptions).set(subscriptionValues)
              .where(eq(subscriptions.id, existingSub.id));
          } else {
            await tx.insert(subscriptions).values({ tenantId: request.tenantId, ...subscriptionValues });
          }

          await tx.insert(payments).values({
            tenantId: request.tenantId,
            userId: request.userId,
            amount: String(billedAmount),
            currency: (session.currency ?? "pkr").toUpperCase(),
            paymentMethod: "stripe",
            status: "completed",
            externalPaymentId: session.id ?? null,
            paidAt: now,
            completedAt: now,
            paymentType: "subscription",
            description: `Stripe checkout: ${request.currentPlan} → ${request.requestedPlan}`,
          });
        });
      }
    }

    if (event.type === "checkout.session.expired") {
      const session = event.data.object;
      const requestId = session.metadata?.requestId ?? session.client_reference_id ?? null;
      if (requestId) {
        await db
          .update(subscriptionRequests)
          .set({ status: "expired", updatedAt: new Date() })
          .where(
            and(
              eq(subscriptionRequests.id, requestId),
              eq(subscriptionRequests.status, "pending"),
            ),
          );
      }
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("[stripe-webhook]", error);
    return NextResponse.json({ error: "Webhook handler failed" }, { status: 500 });
  }
}
