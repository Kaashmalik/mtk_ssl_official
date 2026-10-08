import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@clerk/nextjs/server";
import { db, subscriptionRequests } from "@mtk/database";
import { eq } from "drizzle-orm";
import { getMyTenant } from "@/app/actions/tenants";

/**
 * POST /api/billing/stripe/checkout
 *
 * Creates a Stripe Checkout session for international tenants and records a
 * pending subscription_request so the normal admin approval flow still runs.
 *
 * Gated by STRIPE_SECRET_KEY: without it (the default for PK deployments) this
 * route returns 501 and the UI keeps offering manual bank/wallet transfers.
 */
const schema = z.object({
  plan: z.enum(["starter", "pro", "enterprise"]),
  period: z.enum(["monthly", "annual"]).default("monthly"),
});

const PLAN_PRICES_PKR: Record<string, number> = {
  starter: 4999,
  pro: 14999,
  enterprise: 49999,
};

/** Annual billing is charged as 10 months (2 months free). */
const ANNUAL_MONTHS_FREE = 2;

export async function POST(request: Request) {
  try {
    const { userId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
    }
    const { plan, period } = parsed.data;

    const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
    if (!secretKey) {
      return NextResponse.json(
        { error: "Online card payments are not configured for this deployment." },
        { status: 501 },
      );
    }

    const tenant = await getMyTenant();
    if (!tenant) return NextResponse.json({ error: "No league found" }, { status: 404 });

    const monthly = PLAN_PRICES_PKR[plan];
    const months = period === "annual" ? 12 - ANNUAL_MONTHS_FREE : 1;
    const amount = monthly * months;

    // Record the intent first so the approval queue has an auditable row.
    // payment_proof_url is NOT NULL; it is updated with the real session URL
    // below (the session needs the request id for metadata, hence two steps).
    const [intent] = await db
      .insert(subscriptionRequests)
      .values({
        tenantId: tenant.id,
        userId,
        requestedPlan: plan,
        currentPlan: tenant.plan,
        amount: String(amount),
        paymentMethod: "stripe",
        paymentProofUrl: "stripe://pending",
        transactionReference: `stripe_pending_${Date.now()}`,
        status: "pending",
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      })
      .returning();

    const baseUrl = (process.env.WEB_APP_URL || "").replace(/\/$/, "") || "http://localhost:3001";

    const form = new URLSearchParams();
    form.set("mode", "payment");
    form.set("success_url", `${baseUrl}/dashboard/settings/billing?checkout=success`);
    form.set("cancel_url", `${baseUrl}/dashboard/settings/billing?checkout=cancelled`);
    form.set("client_reference_id", intent.id);
    form.set("line_items[0][quantity]", "1");
    form.set(
      "line_items[0][price_data][currency]",
      // PKR is a zero-decimal currency for Stripe; amounts are whole rupees.
      "pkr",
    );
    form.set("line_items[0][price_data][unit_amount]", String(Math.round(amount * 100)));
    form.set(
      "line_items[0][price_data][product_data][name]",
      `SSL ${plan.charAt(0).toUpperCase() + plan.slice(1)} plan (${period})`,
    );
    form.set("metadata[tenantId]", tenant.id);
    form.set("metadata[plan]", plan);
    form.set("metadata[period]", period);
    form.set("metadata[requestId]", intent.id);

    const res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form,
    });

    const session = (await res.json()) as { url?: string; error?: { message?: string } };
    if (!res.ok || !session.url) {
      // Don't leave a dangling pending request behind.
      await db
        .update(subscriptionRequests)
        .set({ status: "rejected", adminNotes: `Stripe error: ${session.error?.message ?? res.status}` })
        .where(eq(subscriptionRequests.id, intent.id));
      return NextResponse.json(
        { error: session.error?.message ?? "Failed to create checkout session" },
        { status: 502 },
      );
    }

    // Store the session URL as the payment reference for reconciliation.
    await db
      .update(subscriptionRequests)
      .set({ paymentProofUrl: session.url.slice(0, 500) })
      .where(eq(subscriptionRequests.id, intent.id));

    return NextResponse.json({ url: session.url, requestId: intent.id });
  } catch (error) {
    console.error("[billing/stripe/checkout]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}