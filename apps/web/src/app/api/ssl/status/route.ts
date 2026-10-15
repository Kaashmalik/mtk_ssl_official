import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@clerk/nextjs/server";
import { getSslCertificate } from "@/lib/domain-verification";
import { isSuperAdmin } from "@/lib/super-admin";

/** SSL certificate status for a league's custom domain (super-admin gated). */
const querySchema = z.object({
  domain: z.string().min(1).max(253).regex(/^[a-zA-Z0-9][a-zA-Z0-9.-]*$/, "domain looks invalid"),
  tenantId: z.string().uuid(),
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

    const certificate = await getSslCertificate(parsed.data.tenantId, parsed.data.domain);
    if (!certificate) {
      return NextResponse.json({ status: "pending" });
    }

    return NextResponse.json(certificate);
  } catch (error) {
    console.error("Error fetching SSL status:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
