export const dynamic = 'force-dynamic';

import { NextResponse } from "next/server";
import { verifySuperAdmin } from "@/lib/admin-auth";
import { db, tenants, tenantBranding, tournaments, teams, venues } from "@mtk/database";
import { eq } from "drizzle-orm";

// GET /api/tenants/[id] - Get tenant details
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const adminId = await verifySuperAdmin();
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;

    const [tenant] = await db
      .select()
      .from(tenants)
      .where(eq(tenants.id, id))
      .limit(1);

    if (!tenant) {
      return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
    }

    const brandingData = await db
      .select()
      .from(tenantBranding)
      .where(eq(tenantBranding.tenantId, id));

    const tournamentsData = await db
      .select()
      .from(tournaments)
      .where(eq(tournaments.tenantId, id));

    const teamsData = await db
      .select()
      .from(teams)
      .where(eq(teams.tenantId, id));

    const venuesData = await db
      .select()
      .from(venues)
      .where(eq(venues.tenantId, id));

    const tenantWithRelations = {
      ...tenant,
      tenant_branding: brandingData[0] || null,
      tournaments: tournamentsData || [],
      teams: teamsData || [],
      venues: venuesData || [],
    };

    return NextResponse.json({ tenant: tenantWithRelations });
  } catch (error) {
    console.error("Error fetching tenant:", error);
    return NextResponse.json(
      { error: "Failed to fetch tenant" },
      { status: 500 }
    );
  }
}

// PATCH /api/tenants/[id] - Update tenant
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const adminId = await verifySuperAdmin();
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const body = await request.json();
    const { name, slug, plan, is_active, custom_domain, branding } = body;

    // Update tenant
    const [tenant] = await db
      .update(tenants)
      .set({
        name,
        slug,
        plan,
        isActive: is_active,
        customDomain: custom_domain,
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, id))
      .returning();

    if (!tenant) {
      return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
    }

    // Update branding if provided
    if (branding) {
      const mappedBranding: any = { updatedAt: new Date() };
      
      const setIfDefined = (key: string, targetKey: string) => {
        if (branding[key] !== undefined) {
          mappedBranding[targetKey] = branding[key];
        }
      };

      setIfDefined("logo_url", "logoUrl");
      setIfDefined("favicon_url", "faviconUrl");
      setIfDefined("primary_color", "primaryColor");
      setIfDefined("secondary_color", "secondaryColor");
      setIfDefined("accent_color", "accentColor");
      setIfDefined("font_family", "fontFamily");
      setIfDefined("app_name", "appName");
      setIfDefined("hide_ssl_branding", "hideSslBranding");
      setIfDefined("custom_css", "customCss");
      setIfDefined("email_sender_name", "emailSenderName");
      setIfDefined("email_sender_address", "emailSenderAddress");
      setIfDefined("login_page_background_url", "loginPageBackgroundUrl");
      setIfDefined("login_page_custom_html", "loginPageCustomHtml");
      setIfDefined("mobile_app_icon_url", "mobileAppIconUrl");
      setIfDefined("mobile_app_splash_url", "mobileAppSplashUrl");
      setIfDefined("mobile_app_bundle_id", "mobileAppBundleId");
      setIfDefined("mobile_app_package_name", "mobileAppPackageName");
      setIfDefined("separate_database", "separateDatabase");
      setIfDefined("database_instance_url", "databaseInstanceUrl");

      // Also support camelCase keys in case they are sent
      setIfDefined("logoUrl", "logoUrl");
      setIfDefined("faviconUrl", "faviconUrl");
      setIfDefined("primaryColor", "primaryColor");
      setIfDefined("secondaryColor", "secondaryColor");
      setIfDefined("accentColor", "accentColor");
      setIfDefined("fontFamily", "fontFamily");
      setIfDefined("appName", "appName");
      setIfDefined("hideSslBranding", "hideSslBranding");
      setIfDefined("customCss", "customCss");
      setIfDefined("emailSenderName", "emailSenderName");
      setIfDefined("emailSenderAddress", "emailSenderAddress");
      setIfDefined("loginPageBackgroundUrl", "loginPageBackgroundUrl");
      setIfDefined("loginPageCustomHtml", "loginPageCustomHtml");
      setIfDefined("mobileAppIconUrl", "mobileAppIconUrl");
      setIfDefined("mobileAppSplashUrl", "mobileAppSplashUrl");
      setIfDefined("mobileAppBundleId", "mobileAppBundleId");
      setIfDefined("mobileAppPackageName", "mobileAppPackageName");
      setIfDefined("separateDatabase", "separateDatabase");
      setIfDefined("databaseInstanceUrl", "databaseInstanceUrl");

      await db
        .update(tenantBranding)
        .set(mappedBranding)
        .where(eq(tenantBranding.tenantId, id));
    }

    return NextResponse.json({ tenant });
  } catch (error) {
    console.error("Error updating tenant:", error);
    return NextResponse.json(
      { error: "Failed to update tenant" },
      { status: 500 }
    );
  }
}

// DELETE /api/tenants/[id] - Delete tenant
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const adminId = await verifySuperAdmin();
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    
    // Delete tenant (cascade will handle related data)
    await db
      .delete(tenants)
      .where(eq(tenants.id, id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting tenant:", error);
    return NextResponse.json(
      { error: "Failed to delete tenant" },
      { status: 500 }
    );
  }
}

