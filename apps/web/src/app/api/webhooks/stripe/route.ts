import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { db, subscriptionRequests, tenants, subscriptions, payments } from "@mtk/database";
import { and, eq } from "drizzle-orm";

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

      if (requestId) {
        const [request] = await db
          .select()
          .from(subscriptionRequests)
          .where(
            and(
              eq(subscriptionRequests.id, requestId),
              eq(subscriptionRequests.status, "pending"),
            ),
          )
          .limit(1);

        if (request) {
          const now = new Date();
          const periodEnd = new Date(now);
          const months = request.paymentMethod === "stripe" ? 1 : 1;
          periodEnd.setMonth(periodEnd.getMonth() + months);

          await db
            .update(subscriptionRequests)
            .set({
              status: "approved",
              transactionReference: session.id ?? `stripe_${Date.now()}`,
              reviewedAt: now,
              updatedAt: now,
              adminNotes: "Auto-approved via Stripe webhook",
            })
            .where(eq(subscriptionRequests.id, request.id));

          await db
            .update(tenants)
            .set({ plan: request.requestedPlan as "starter" | "pro" | "enterprise", updatedAt: now })
            .where(eq(tenants.id, request.tenantId));

          const [existingSub] = await db
            .select()
            .from(subscriptions)
            .where(eq(subscriptions.tenantId, request.tenantId))
            .limit(1);

          if (existingSub) {
            await db
              .update(subscriptions)
              .set({
                plan: request.requestedPlan,
                status: "active",
                currentPeriodStart: now,
                currentPeriodEnd: periodEnd,
                updatedAt: now,
              })
              .where(eq(subscriptions.id, existingSub.id));
          } else {
            await db.insert(subscriptions).values({
              tenantId: request.tenantId,
              plan: request.requestedPlan,
              status: "active",
              monthlyAmount: request.amount,
              currency: "PKR",
              paymentMethod: "stripe",
              currentPeriodStart: now,
              currentPeriodEnd: periodEnd,
            });
          }

          const amountTotal = session.amount_total ?? Number(request.amount) * 100;
          await db.insert(payments).values({
            tenantId: request.tenantId,
            userId: request.userId,
            // Stripe reports minor units; PKR is zero-decimal but divide defensively.
            amount: String(amountTotal / 100),
            currency: (session.currency ?? "pkr").toUpperCase(),
            paymentMethod: "stripe",
            status: "completed",
            externalPaymentId: session.id ?? null,
            paidAt: now,
            completedAt: now,
            paymentType: "subscription",
            description: `Stripe checkout: ${request.currentPlan} → ${request.requestedPlan}`,
          });
        }
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