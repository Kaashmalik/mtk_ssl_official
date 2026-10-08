/**
 * Subscription Request API — creates a manual payment upgrade request.
 *
 * POST: Creates a subscription_requests row with payment proof + plan details.
 * GET:  Lists the tenant's subscription requests (for the billing page).
 *
 * The user must be authenticated and own a tenant. The request enters a
 * "pending" status and waits for super admin approval.
 */

export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db, tenants, users, subscriptionRequests } from "@mtk/database";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";
import { PLAN_PRICES } from "@mtk/database/lib/plan-limits";

// Valid plans and payment methods are validated by createRequestSchema below.

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
    // Find the user's Clerk-linked DB record
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.clerkId, userId))
      .limit(1);

    if (!user) {
      return NextResponse.json(
        { error: "User record not found. Please contact support." },
        { status: 404 }
      );
    }

    // Resolve the Clerk identity to the internal UUID used by tenants.owner_id.
    const [tenantOwner] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.clerkId, userId))
      .limit(1);

    if (!tenantOwner) {
      return NextResponse.json({ error: "User record not found" }, { status: 404 });
    }

    // Only the league owner may manage billing.
    const [tenant] = await db
      .select()
      .from(tenants)
      .where(eq(tenants.ownerId, tenantOwner.id))
      .limit(1);

    if (!tenant) {
      return NextResponse.json(
        { error: "No league found. Create a league first." },
        { status: 404 }
      );
    }

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

    // Receipts must be the short-lived signed URLs produced by our private
    // payment-proofs bucket, namespaced to this authenticated Clerk account.
    // This prevents arbitrary external URLs from being stored and opened by
    // reviewers as part of the payment approval flow.
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

    // Check for existing pending request (prevent duplicates)
    const [existingPending] = await db
      .select()
      .from(subscriptionRequests)
      .where(
        and(
          eq(subscriptionRequests.tenantId, tenant.id),
          eq(subscriptionRequests.status, "pending")
        )
      )
      .limit(1);

    if (existingPending) {
      return NextResponse.json(
        { error: "You already have a pending upgrade request. Please wait for admin review." },
        { status: 409 }
      );
    }

    // Determine the amount from the plan prices
    const amount = PLAN_PRICES[requestedPlan];
    if (amount === undefined) {
      return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
    }

    // Calculate expiry: 7 days from now
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    // Create the subscription request
    const [request] = await db
      .insert(subscriptionRequests)
      .values({
        tenantId: tenant.id,
        userId: user.id,
        requestedPlan,
        currentPlan: tenant.plan,
        amount: String(amount),
        paymentMethod,
        paymentProofUrl,
        transactionReference,
        status: "pending",
        expiresAt,
      })
      .returning();

    return NextResponse.json({ success: true, request }, { status: 201 });
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
    const [tenantOwner] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.clerkId, userId))
      .limit(1);

    if (!tenantOwner) {
      return NextResponse.json({ error: "User record not found" }, { status: 404 });
    }

    // Find the tenant the authenticated league owner is authorized to bill.
    const [tenant] = await db
      .select({ id: tenants.id, plan: tenants.plan })
      .from(tenants)
      .where(eq(tenants.ownerId, tenantOwner.id))
      .limit(1);

    if (!tenant) {
      return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
    }

    // Fetch subscription requests for this tenant (newest first)
    const requests = await db
      .select()
      .from(subscriptionRequests)
      .where(eq(subscriptionRequests.tenantId, tenant.id))
      .orderBy(desc(subscriptionRequests.createdAt))
      .limit(20);

    return NextResponse.json({
      tenant,
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
