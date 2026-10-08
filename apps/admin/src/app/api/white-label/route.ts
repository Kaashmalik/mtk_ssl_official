export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { verifySuperAdmin } from "@/lib/admin-auth";
import {
  db,
  whiteLabelRequests,
  tenants,
  tenantBranding,
  dnsVerifications,
} from "@mtk/database";
import { and, desc, eq } from "drizzle-orm";
import { captureError, getRequestLogger } from "@mtk/observability";

export async function GET(request: NextRequest) {
  const adminId = await verifySuperAdmin();
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const status = (searchParams.get("status") || "pending") as any;

    const data = await db
      .select({
        id: whiteLabelRequests.id,
        tenantId: whiteLabelRequests.tenantId,
        requestedBy: whiteLabelRequests.requestedBy,
        status: whiteLabelRequests.status,
        customDomain: whiteLabelRequests.customDomain,
        hideBranding: whiteLabelRequests.hideBranding,
        customAppName: whiteLabelRequests.customAppName,
        reason: whiteLabelRequests.reason,
        adminNotes: whiteLabelRequests.adminNotes,
        reviewedBy: whiteLabelRequests.reviewedBy,
        reviewedAt: whiteLabelRequests.reviewedAt,
        createdAt: whiteLabelRequests.createdAt,
        updatedAt: whiteLabelRequests.updatedAt,
        tenant: {
          id: tenants.id,
          name: tenants.name,
          slug: tenants.slug,
          plan: tenants.plan,
        }
      })
      .from(whiteLabelRequests)
      .innerJoin(tenants, eq(whiteLabelRequests.tenantId, tenants.id))
      .where(eq(whiteLabelRequests.status, status))
      .orderBy(desc(whiteLabelRequests.createdAt));

    const requests = data.map((item) => ({
      id: item.id,
      tenant_id: item.tenantId,
      requested_by: item.requestedBy,
      status: item.status,
      custom_domain: item.customDomain,
      hide_branding: item.hideBranding,
      custom_app_name: item.customAppName,
      reason: item.reason,
      admin_notes: item.adminNotes,
      reviewed_by: item.reviewedBy,
      reviewed_at: item.reviewedAt ? item.reviewedAt.toISOString() : null,
      created_at: item.createdAt.toISOString(),
      updated_at: item.updatedAt.toISOString(),
      tenants: item.tenant,
    }));

    return NextResponse.json({ requests });
  } catch (error) {
    getRequestLogger().error("White-label requests API error", error);
    await captureError(error, {
      level: "error",
      context: { adminId, path: "/api/white-label" },
      tags: { source: "white-label", method: "GET" },
    });
    return NextResponse.json(
      { error: "Failed to fetch white-label requests" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  const adminId = await verifySuperAdmin();
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { requestId, status, adminNotes } = await request.json();

    if (!requestId || !status) {
      return NextResponse.json(
        { error: "requestId and status are required" },
        { status: 400 }
      );
    }

    const [data] = await db
      .update(whiteLabelRequests)
      .set({
        status,
        adminNotes: adminNotes || null,
        reviewedBy: adminId,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(whiteLabelRequests.id, requestId))
      .returning();

    if (!data) {
      return NextResponse.json(
        { error: "Request not found" },
        { status: 404 }
      );
    }

    if (data) {
      if (status === "approved") {
        await db
          .insert(tenantBranding)
          .values({
            tenantId: data.tenantId,
            hideSslBranding: data.hideBranding,
            appName: data.customAppName || null,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: tenantBranding.tenantId,
            set: {
              hideSslBranding: data.hideBranding,
              appName: data.customAppName || null,
              updatedAt: new Date(),
            }
          });

        if (data.customDomain) {
          await db
            .update(tenants)
            .set({
              customDomain: data.customDomain,
              customDomainVerified: false,
              customDomainVerifiedAt: null,
              updatedAt: new Date(),
            })
            .where(eq(tenants.id, data.tenantId));

          // --- Auto-create the DNS ownership verification record ---
          // This bridges the gap between approval and the verification flow:
          // previously the tenant had no way to know WHICH TXT record to add
          // until a super-admin manually visited the branding settings page.
          // Now approval immediately issues a verification token.
          await createDnsVerificationForDomain(data.tenantId, data.customDomain);
        }
      }

      if (status === "revoked") {
        await db
          .insert(tenantBranding)
          .values({
            tenantId: data.tenantId,
            hideSslBranding: false,
            appName: null,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: tenantBranding.tenantId,
            set: {
              hideSslBranding: false,
              appName: null,
              updatedAt: new Date(),
            }
          });

        await db
          .update(tenants)
          .set({
            customDomain: null,
            customDomainVerified: false,
            customDomainVerifiedAt: null,
            updatedAt: new Date(),
          })
          .where(eq(tenants.id, data.tenantId));
      }
    }

    // Map to snake_case format for return
    const mappedResponse = {
      id: data.id,
      tenant_id: data.tenantId,
      requested_by: data.requestedBy,
      status: data.status,
      custom_domain: data.customDomain,
      hide_branding: data.hideBranding,
      custom_app_name: data.customAppName,
      reason: data.reason,
      admin_notes: data.adminNotes,
      reviewed_by: data.reviewedBy,
      reviewed_at: data.reviewedAt ? data.reviewedAt.toISOString() : null,
      created_at: data.createdAt.toISOString(),
      updated_at: data.updatedAt.toISOString(),
    };

    return NextResponse.json({ request: mappedResponse });
  } catch (error) {
    getRequestLogger().error("Update white-label request error", error);
    await captureError(error, {
      level: "error",
      context: { adminId, path: "/api/white-label" },
      tags: { source: "white-label", method: "PATCH" },
    });
    return NextResponse.json(
      { error: "Failed to update white-label request" },
      { status: 500 }
    );
  }
}

/**
 * Create (or refresh) the DNS ownership verification record for a domain.
 *
 * Generates a random token, stores it in dns_verifications with status
 * 'pending', and sets a 7-day expiry. The tenant then adds the TXT record:
 *
 *   _ssl-verify.<domain>  TXT  ssl-verify-<token>
 *
 * The web app's /api/dns/verify route checks this record against live DNS.
 *
 * If a pending verification already exists for this tenant+domain, it is
 * replaced (revoked) so there's only ever one active token.
 */
async function createDnsVerificationForDomain(
  tenantId: string,
  domain: string
): Promise<void> {
  const token = randomBytes(16).toString("hex"); // 32 hex chars
  const expectedValue = `ssl-verify-${token}`;
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  // Revoke any existing pending verification for this tenant+domain so the
  // tenant only ever sees one valid token.
  await db
    .update(dnsVerifications)
    .set({ status: "expired", updatedAt: new Date() })
    .where(
      and(
        eq(dnsVerifications.tenantId, tenantId),
        eq(dnsVerifications.domain, domain),
        eq(dnsVerifications.status, "pending")
      )
    );

  await db.insert(dnsVerifications).values({
    tenantId,
    domain,
    verificationToken: token,
    verificationType: "txt",
    expectedValue,
    status: "pending",
    expiresAt,
  });
}


