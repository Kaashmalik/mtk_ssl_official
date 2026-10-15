import { NextResponse } from "next/server";
import { expireCheckoutSession, settleCheckoutCompleted, verifyStripeSignature } from "@/lib/stripe-billing";
import type { CheckoutEventSession } from "@/lib/stripe-billing";

export const dynamic = "force-dynamic";

/**
 * POST /api/webhooks/stripe
 *
 * Settles a subscription_request once payment succeeds, so an international
 * tenant activates without a human approval step. Signature verifies Stripe's
 * signed-payload scheme (t=/v1, HMAC-SHA256, five-minute tolerance) with the
 * raw body; settlement is idempotent — duplicate deliveries of
 * `checkout.session.completed` short-circuit on the claimed pending request.
 */
export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  const body = await request.text();

  if (!secret) {
    return NextResponse.json({ error: "Stripe webhook not configured" }, { status: 501 });
  }

  const verified = verifyStripeSignature({
    secret, header: request.headers.get("stripe-signature") ?? "", body, nowMs: Date.now(),
  });
  if (!verified.ok) {
    const messages = {
      missing_header: "Missing stripe-signature header",
      outside_tolerance: "Timestamp outside tolerance",
      invalid: "Invalid signature",
    } as const;
    return NextResponse.json({ error: messages[verified.reason] }, { status: 400 });
  }

  let event: { type: string; data: { object: CheckoutEventSession } };
  try {
    event = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    if (event.type === "checkout.session.completed") {
      await settleCheckoutCompleted(event.data.object);
    }

    if (event.type === "checkout.session.expired") {
      const session = event.data.object;
      const requestId = session.metadata?.requestId ?? session.client_reference_id ?? null;
      await expireCheckoutSession(requestId);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("[stripe-webhook]", error);
    return NextResponse.json({ error: "Webhook handler failed" }, { status: 500 });
  }
}
