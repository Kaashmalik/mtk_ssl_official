import { headers } from "next/headers";
import { db } from "@mtk/database";
import { tenants, tenantBranding } from "@mtk/database";
import { and, eq } from "drizzle-orm";
import { normalizeHost, tenantSlugCandidates } from "./tenant-host";

/**
 * Get tenant from custom domain or subdomain
 */
export async function getTenantFromRequest() {
  const headersList = await headers();
  const host = normalizeHost(headersList.get("x-forwarded-host") ?? headersList.get("host"));
  
  // Check for custom domain first
  const customDomainTenant = await db
    .select()
    .from(tenants)
    .where(and(
      eq(tenants.customDomain, host),
      eq(tenants.customDomainVerified, true),
      eq(tenants.sslEnabled, true),
      eq(tenants.isActive, true),
    ))
    .limit(1);

  if (customDomainTenant.length > 0) {
    return customDomainTenant[0];
  }

  // Check for subdomain (e.g., myleague.ssl.mtkcodex.site)
  const subdomain = tenantSlugCandidates(host)[0];
  if (subdomain) {
    const subdomainTenant = await db
      .select()
      .from(tenants)
      .where(and(eq(tenants.slug, subdomain), eq(tenants.isActive, true)))
      .limit(1);

    if (subdomainTenant.length > 0) {
      return subdomainTenant[0];
    }
  }

  return null;
}

/**
 * Get tenant branding configuration
 */
export async function getTenantBranding(tenantId: string) {
  const branding = await db
    .select()
    .from(tenantBranding)
    .where(eq(tenantBranding.tenantId, tenantId))
    .limit(1);

  return branding[0] || null;
}

/**
 * Get complete tenant info with branding
 */
export async function getTenantWithBranding() {
  const tenant = await getTenantFromRequest();
  if (!tenant) return null;

  const branding = await getTenantBranding(tenant.id);
  return {
    tenant,
    branding,
  };
}

