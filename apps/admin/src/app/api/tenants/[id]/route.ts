export const dynamic = 'force-dynamic';

import { NextResponse } from "next/server";
import { verifySuperAdmin } from "@/lib/admin-auth";
import { createTenantDeletionRequest } from "@/lib/admin-approvals";
import { writeAuditLog } from "@/lib/audit-log";
import {
  db,
  tenants,
  tenantBranding,
  tournaments,
  teams,
  venues,
  userTenantRoles,
  users,
  normalizeApprovalReason,
  ADMIN_APPROVAL_MIN_REASON_LENGTH,
} from "@mtk/database";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";

const isUuid = (value: string) => z.string().uuid().safeParse(value).success;

// GET /api/tenants/[id] - Get tenant details
//
// ENH-02-03: the payload is now an EXACT DTO. It used to spread raw drizzle
// rows (camelCase) under snake_case keys the detail page expected
// (tenant_branding as an array, is_active, created_at, logo_url, ...), so the
// console read undefined for every one of those fields. Every field below is
// a deliberate, camelCase, JSON-safe projection, and the member roster rides
// on the authoritative user_tenant_roles rows (ISO-06), not a retired
// users.tenantIds array.
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

    const [branding] = await db
      .select({
        logoUrl: tenantBranding.logoUrl,
        primaryColor: tenantBranding.primaryColor,
        secondaryColor: tenantBranding.secondaryColor,
        appName: tenantBranding.appName,
        hideSslBranding: tenantBranding.hideSslBranding,
      })
      .from(tenantBranding)
      .where(eq(tenantBranding.tenantId, id))
      .limit(1);

    const membersData = await db
      .select({
        userId: userTenantRoles.userId,
        role: userTenantRoles.role,
        status: userTenantRoles.status,
        displayName: users.displayName,
        email: users.email,
      })
      .from(userTenantRoles)
      .innerJoin(users, eq(userTenantRoles.userId, users.id))
      .where(eq(userTenantRoles.tenantId, id))
      .orderBy(asc(userTenantRoles.createdAt));

    const tournamentsData = await db
      .select({ id: tournaments.id, name: tournaments.name, status: tournaments.status })
      .from(tournaments)
      .where(eq(tournaments.tenantId, id));

    const teamsData = await db
      .select({ id: teams.id, name: teams.name })
      .from(teams)
      .where(eq(teams.tenantId, id));

    const venuesData = await db
      .select({ id: venues.id, name: venues.name })
      .from(venues)
      .where(eq(venues.tenantId, id));

    const tenantWithRelations = {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      customDomain: tenant.customDomain ?? null,
      plan: tenant.plan,
      isActive: tenant.isActive === true,
      createdAt: tenant.createdAt.toISOString(),
      updatedAt: tenant.updatedAt.toISOString(),
      branding: branding ?? null,
      members: membersData,
      tournaments: tournamentsData,
      teams: teamsData,
      venues: venuesData,
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
    // ENH-02-03: canonical camelCase with a snake_case fallback for the
    // legacy caller payload — one truth inside (isActive/customDomain).
    const bodyFields = body as {
      name?: string; slug?: string; plan?: string;
      is_active?: boolean; isActive?: boolean;
      custom_domain?: string | null; customDomain?: string | null;
      branding?: Record<string, unknown>;
    };
    const { name, slug, branding } = bodyFields;
    const is_active = bodyFields.is_active ?? bodyFields.isActive;
    const custom_domain = bodyFields.custom_domain ?? bodyFields.customDomain;
    // tenants.plan is an enum column: an out-of-vocabulary value must not be
    // written (and previously a missing field silently nulled siblings).
    const VALID_PLANS = ["free", "starter", "pro", "enterprise"] as const;
    const plan = VALID_PLANS.find((candidate) => candidate === bodyFields.plan);

    // Update tenant
    const [tenant] = await db
      .update(tenants)
      .set({
        ...(name !== undefined ? { name } : {}),
        ...(slug !== undefined ? { slug } : {}),
        ...(plan !== undefined ? { plan } : {}),
        ...(is_active !== undefined ? { isActive: is_active } : {}),
        ...(custom_domain !== undefined ? { customDomain: custom_domain } : {}),
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

    await writeAuditLog({
      method: "PATCH",
      path: `/api/tenants/${id}`,
      actorId: adminId,
      actorRole: "super_admin",
      tenantId: id,
      payload: {
        action: "tenant.updated",
        changed: {
          ...(name !== undefined ? { name } : {}),
          ...(slug !== undefined ? { slug } : {}),
          ...(plan !== undefined ? { plan } : {}),
          ...(is_active !== undefined ? { isActive: is_active } : {}),
          ...(custom_domain !== undefined ? { customDomain: custom_domain } : {}),
          ...(branding ? { brandingKeys: Object.keys(branding) } : {}),
        },
      },
      statusCode: "200",
      request,
    });

    return NextResponse.json({ tenant });
  } catch (error) {
    console.error("Error updating tenant:", error);
    return NextResponse.json(
      { error: "Failed to update tenant" },
      { status: 500 }
    );
  }
}

// DELETE /api/tenants/[id] - Request deletion of a tenant
//
// Deleting a league cascades through every league-owned row and cannot be
// undone, so it is a two-person action: this records a pending request with a
// reason and returns 202. Nothing is deleted until a DIFFERENT super admin
// approves it via POST /api/admin-approvals/[id].
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const adminId = await verifySuperAdmin();
  if (!adminId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
  }
  const body = (await request.json().catch(() => null)) as { reason?: unknown } | null;
  const reason = normalizeApprovalReason(body?.reason);
  if (!reason) {
    return NextResponse.json(
      { error: `Explain why in at least ${ADMIN_APPROVAL_MIN_REASON_LENGTH} characters.` },
      { status: 400 }
    );
  }

  return createTenantDeletionRequest({ adminId, tenantId: id, reason, request });
}

