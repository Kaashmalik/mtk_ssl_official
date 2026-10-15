import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@clerk/nextjs/server";
import {
  checkEmailDnsRecords,
  getEmailVerification,
  markEmailVerified,
  toClientEmailVerification,
  upsertEmailVerification,
} from "@/lib/domain-verification";
import { isSuperAdmin } from "@/lib/super-admin";
import { captureError, getRequestLogger } from "@mtk/observability";

/**
 * Email sending-domain verification (SPF / DKIM / DMARC), super-admin gated.
 * Responses are redacted: the DKIM private key stays in the database for the
 * mail service and is never returned to a client.
 */
const querySchema = z.object({
  domain: z.string().min(1).max(253).regex(/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/, "domain looks invalid"),
  tenantId: z.string().uuid(),
});
const bodySchema = querySchema.extend({
  senderEmail: z.string().email().max(254),
});

export async function GET(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const isAdmin = await isSuperAdmin();
    if (!isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const parsed = querySchema.safeParse({
      domain: request.nextUrl.searchParams.get("domain"),
      tenantId: request.nextUrl.searchParams.get("tenantId"),
    });
    if (!parsed.success) {
      return NextResponse.json({ error: "Domain and tenantId required" }, { status: 400 });
    }
    const { domain, tenantId } = parsed.data;

    const verification = await getEmailVerification(tenantId, domain);
    if (!verification) {
      return NextResponse.json({ error: "Verification not found" }, { status: 404 });
    }

    const isVerified = await checkEmailDnsRecords(domain, verification);
    if (isVerified && verification.status !== "verified") {
      const now = new Date();
      await markEmailVerified(verification.id, tenantId, now);
      return NextResponse.json(
        toClientEmailVerification({ ...verification, status: "verified", verifiedAt: now, lastCheckedAt: now }),
      );
    }

    return NextResponse.json(toClientEmailVerification(verification));
  } catch (error) {
    getRequestLogger().error("Error checking email verification", error);
    await captureError(error, {
      level: "error",
      tags: { source: "email-verify", method: "GET" },
    });
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

    const isAdmin = await isSuperAdmin();
    if (!isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Domain, sender email, and tenantId required" },
        { status: 400 }
      );
    }
    const { tenantId, ...data } = parsed.data;

    const verification = await upsertEmailVerification({ tenantId, ...data });
    return NextResponse.json(toClientEmailVerification(verification));
  } catch (error) {
    getRequestLogger().error("Error initiating email verification", error);
    await captureError(error, {
      level: "error",
      tags: { source: "email-verify", method: "POST" },
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
