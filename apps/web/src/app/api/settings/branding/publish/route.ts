import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@clerk/nextjs/server";
import { publishBrandingDraft } from "@/lib/branding-settings";
import { isSuperAdmin } from "@/lib/super-admin";

export const dynamic = "force-dynamic";

/**
 * Brand Studio publish (PREM-02, Batch 135): moves the saved draft into the
 * active published snapshot (keeping the previous snapshot for one-step
 * rollback). The route tier owns session + super-admin gating + body
 * validation; the writer owns the tenant lock, the draft-shape guarantee
 * and the audit.
 */
export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!(await isSuperAdmin())) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const parsed = z.object({ tenantId: z.string().uuid() }).safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
    }

    const result = await publishBrandingDraft({ tenantId: parsed.data.tenantId });
    if ("missing" in result) {
      return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
    }
    if ("nothingToPublish" in result) {
      return NextResponse.json({ changed: false, reason: "no draft" }, { status: 200 });
    }
    return NextResponse.json({ changed: true, published: result.published });
  } catch (error) {
    console.error("Error publishing branding draft:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
