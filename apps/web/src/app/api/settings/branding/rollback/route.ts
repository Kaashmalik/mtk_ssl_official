import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@clerk/nextjs/server";
import { resolveBrandingActor, rollbackBranding } from "@/lib/branding-settings";
import { isSuperAdmin } from "@/lib/super-admin";

export const dynamic = "force-dynamic";

/**
 * Brand Studio rollback (PREM-02, Batch 135): swaps the active snapshot back
 * to the previous one under the tenant lock. A replay (no previous snapshot,
 * e.g. right after the first publish) answers changed:false honestly - it
 * never fabricates a revert.
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

    const result = await rollbackBranding({
      tenantId: parsed.data.tenantId,
      // Batch 176: brand audit rows record the acting platform user.
      actorId: await resolveBrandingActor(userId),
    });
    if ("missing" in result) {
      return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
    }
    if ("changed" in result) {
      return NextResponse.json({ changed: false, reason: "no previous snapshot" }, { status: 200 });
    }
    return NextResponse.json({ changed: true, published: result.published });
  } catch (error) {
    console.error("Error rolling back branding:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
