import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@clerk/nextjs/server";
import { db } from "@mtk/database";
import { tenants } from "@mtk/database";
import { eq } from "drizzle-orm";
import {
  canManageTenantDomain,
  checkDnsRecord,
  getDnsVerification,
  getDnsVerificationById,
  markDnsVerified,
  upsertDnsVerification,
} from "@/lib/domain-verification";

export const dynamic = "force-dynamic";

/** Custom-domain DNS verification (TXT `_ssl-verify.<domain>`).
 *  Authorized for super admins or exactly the league owner; the domain must
 *  be the league's assigned enterprise custom domain. Inputs are validated;
 *  the minted token rotates on every POST so only currently served
 *  instructions can verify. */
const querySchema = z.object({
  domain: z.string().min(1).max(253).regex(/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/, "domain looks invalid"),
  tenantId: z.string().uuid(),
});
const bodySchema = querySchema;

export async function GET(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const parsed = querySchema.safeParse({
      domain: request.nextUrl.searchParams.get("domain"),
      tenantId: request.nextUrl.searchParams.get("tenantId"),
    });
    if (!parsed.success) {
      return NextResponse.json({ error: "Domain and tenantId required" }, { status: 400 });
    }
    const { domain, tenantId } = parsed.data;

    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    if (!tenant) {
      return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
    }
    if (!(await canManageTenantDomain(userId, tenantId))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (tenant.customDomain !== domain) {
      return NextResponse.json({ error: "This domain is not assigned to the league" }, { status: 409 });
    }

    const verification = await getDnsVerification(tenantId, domain);
    if (!verification) {
      return NextResponse.json({ error: "Verification not found" }, { status: 404 });
    }

    const now = new Date();
    const isVerified = await checkDnsRecord(domain, verification.verificationType, verification.expectedValue);
    if (isVerified && verification.status !== "verified") {
      await markDnsVerified(verification.id, tenantId, now);
    }

    const updated = await getDnsVerificationById(verification.id);
    return NextResponse.json(updated);
  } catch (error) {
    console.error("Error checking DNS verification:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Domain and tenantId required" }, { status: 400 });
    }
    const { domain, tenantId } = parsed.data;

    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    if (!tenant) {
      return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
    }
    if (!(await canManageTenantDomain(userId, tenantId))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // An approved custom domain requires the enterprise plan.
    if (tenant.plan !== "enterprise" || tenant.customDomain !== domain) {
      return NextResponse.json(
        { error: "An approved custom domain requires an Enterprise plan" },
        { status: 403 }
      );
    }

    const verification = await upsertDnsVerification(tenantId, domain);
    return NextResponse.json(verification);
  } catch (error) {
    console.error("Error initiating DNS verification:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
