/**
 * Manual (bank/wallet) subscription upgrade requests, the non-Stripe sibling
 * of api/billing/stripe/checkout. Owner-only; creation is serialized per
 * league (lib/subscription-requests) so two concurrent submissions cannot
 * both mint live requests; the loser 409s. Receipts must be the short-lived
 * signed URLs produced by our private payment-proofs bucket, namespaced to
 * the authenticated account — arbitrary external URLs are refused so
 * reviewers never open attacker-chosen links.
 */

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { PLAN_PRICES } from "@mtk/database/lib/plan-limits";
import { createManualSubscriptionRequest, findOwnedTenant, listSubscriptionRequests } from "@/lib/subscription-requests";

const createRequestSchema = z.object({
  requestedPlan: z.enum(["starter", "pro", "enterprise"]),
  paymentMethod: z.enum(["bank_transfer", "jazzcash_manual", "easypaisa_manual"]),
  paymentProofUrl: z.string().url("Invalid receipt URL"),
  transactionReference: z.string().min(3, "Transaction reference is required").max(100),
});

export async function POST(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const owned = await findOwnedTenant(userId);
    if (!owned.ok) {
      if (owned.reason === "user_missing") {
        return NextResponse.json(
          { error: "User record not found. Please contact support." },
          { status: 404 }
        );
      }
      return NextResponse.json(
        { error: "No league found. Create a league first." },
        { status: 404 }
      );
    }
    const { userId: actorId, tenant } = owned;

    // Parse and validate request body
    const body = await req.json();
    const validated = createRequestSchema.safeParse(body);

    if (!validated.success) {
      return NextResponse.json(
        { error: "Validation failed", details: validated.error.flatten() },
        { status: 400 }
      );
    }

    const { requestedPlan, paymentMethod, paymentProofUrl, transactionReference } = validated.data;

    const configuredStorageUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!configuredStorageUrl) {
      return NextResponse.json({ error: "Receipt storage is not configured" }, { status: 503 });
    }
    let proofUrl: URL;
    let storageUrl: URL;
    try {
      proofUrl = new URL(paymentProofUrl);
      storageUrl = new URL(configuredStorageUrl);
    } catch {
      return NextResponse.json({ error: "Invalid payment receipt URL" }, { status: 400 });
    }
    const expectedReceiptPrefix = `/storage/v1/object/sign/payment-proofs/receipts/${userId}/`;
    if (
      proofUrl.origin !== storageUrl.origin ||
      !proofUrl.pathname.startsWith(expectedReceiptPrefix) ||
      !proofUrl.searchParams.has("token")
    ) {
      return NextResponse.json({ error: "Receipt must be uploaded through SSL's private receipt uploader" }, { status: 400 });
    }

    // Amount comes from the authoritative plan price table.
    const amount = PLAN_PRICES[requestedPlan];
    if (amount === undefined) {
      return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
    }

    const created = await createManualSubscriptionRequest({
      tenantId: tenant.id,
      userId: actorId,
      requestedPlan,
      currentPlan: tenant.plan,
      amount,
      paymentMethod,
      paymentProofUrl,
      transactionReference,
    });
    if ("conflict" in created) {
      return NextResponse.json(
        { error: "You already have a pending upgrade request. Please wait for admin review." },
        { status: 409 }
      );
    }

    return NextResponse.json({ success: true, request: created.request }, { status: 201 });
  } catch (error) {
    console.error("[subscription-request] Error:", error);
    return NextResponse.json(
      { error: "Failed to create subscription request" },
      { status: 500 }
    );
  }
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const owned = await findOwnedTenant(userId);
    if (!owned.ok) {
      return NextResponse.json(
        { error: owned.reason === "user_missing" ? "User record not found" : "Tenant not found" },
        { status: 404 }
      );
    }

    const requests = await listSubscriptionRequests(owned.tenant.id, 20);

    return NextResponse.json({
      tenant: { id: owned.tenant.id, plan: owned.tenant.plan },
      requests,
    });
  } catch (error) {
    console.error("[subscription-request] Error fetching requests:", error);
    return NextResponse.json(
      { error: "Failed to fetch subscription requests" },
      { status: 500 }
    );
  }
}
