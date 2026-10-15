import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@clerk/nextjs/server";
import { getBrandingSettings, saveBrandingSettings } from "@/lib/branding-settings";
import { isSuperAdmin } from "@/lib/super-admin";

export const dynamic = "force-dynamic";

/**
 * Super-admin league branding settings. All reads and writes delegate to
 * lib/branding-settings (tenant-locked upsert, plan gating evaluated against
 * the plan read under the lock). The PUT body is validated server-side; the
 * admin UI additionally validates with its own zod schema before sending.
 */
const schema = z.object({
  tenantId: z.string().uuid(),
  logoUrl: z.string().max(2048).nullable().optional(),
  faviconUrl: z.string().max(2048).nullable().optional(),
  primaryColor: z.string().max(64).nullable().optional(),
  secondaryColor: z.string().max(64).nullable().optional(),
  accentColor: z.string().max(64).nullable().optional(),
  fontFamily: z.string().max(128).nullable().optional(),
  appName: z.string().max(128).nullable().optional(),
  hideSslBranding: z.boolean().optional(),
  emailSenderName: z.string().max(128).nullable().optional(),
  emailSenderAddress: z.string().max(254).nullable().optional(),
  mobileAppIconUrl: z.string().max(2048).nullable().optional(),
  mobileAppSplashUrl: z.string().max(2048).nullable().optional(),
  mobileAppBundleId: z.string().max(256).nullable().optional(),
  mobileAppPackageName: z.string().max(256).nullable().optional(),
  customDomain: z.string().max(253).nullable().optional(),
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

    const tenantId = request.nextUrl.searchParams.get("tenantId");
    if (!tenantId) {
      return NextResponse.json({ error: "tenantId is required" }, { status: 400 });
    }

    const result = await getBrandingSettings(tenantId);
    if ("missing" in result) {
      return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
    }

    return NextResponse.json({
      ...(result.branding ?? {}),
      customDomain: result.tenant.customDomain,
    });
  } catch (error) {
    console.error("Error fetching branding settings:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const isAdmin = await isSuperAdmin();
    if (!isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const { tenantId, ...data } = parsed.data;

    const result = await saveBrandingSettings({ tenantId, data });
    if ("missing" in result) {
      return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
    }
    if ("violation" in result) {
      return NextResponse.json({ error: result.violation }, { status: 403 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating branding settings:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
