import { headers } from "next/headers";
import { and, eq, or } from "drizzle-orm";
import { db, tenants } from "@mtk/database";
import { normalizeHost, tenantSlugCandidates } from "./tenant-host";

/**
 * Tenant resolution for PUBLIC (unauthenticated) pages.
 *
 * Public routes — `/matches/[id]`, `/matches/[id]/live`, `/tournaments/[id]` —
 * are intentionally reachable without a session, but they were reading rows by
 * primary key alone. Any party holding a match UUID could therefore load another
 * tenant's scorecard, player names, venue, and live stream URL. Match ids are
 * `uuid_generate_v7()`, which is time-ordered and so more guessable than v4.
 *
 * These pages are now scoped to the tenant that owns the request host: a match
 * is visible only on its own tenant's subdomain or custom domain.
 *
 * Fail-closed: when no tenant can be resolved, callers get `null` and are
 * expected to 404 rather than fall back to an unscoped read.
 */

export type PublicTenantContext = {
  tenantId: string;
  slug: string | null;
};

/**
 * Explicit local-development escape hatch.
 *
 * Host-based resolution requires reaching the app via a tenant subdomain
 * (`http://ssl.localhost:3001`). Plain `http://localhost:3001` carries no
 * tenant, so public pages would 404 during local development.
 *
 * `PUBLIC_TENANT_SLUG` names the tenant to assume. It is honoured ONLY outside
 * production, so it cannot weaken isolation on a real deployment — an unset or
 * ignored variable yields `null` and the page 404s as usual.
 */
function devTenantSlugOverride(): string | null {
  if (process.env.NODE_ENV === "production") return null;
  const slug = process.env.PUBLIC_TENANT_SLUG?.trim();
  return slug || null;
}

/**
 * Resolves the tenant that owns the current request.
 *
 * Lookup order:
 *   1. exact `customDomain` match on the host
 *   2. tenant `slug` taken from the subdomain
 *   3. (non-production only) `PUBLIC_TENANT_SLUG`
 */
export async function getPublicTenantContext(): Promise<PublicTenantContext | null> {
  const headersList = await headers();

  // `x-forwarded-host` is what the edge proxy sets; `host` is the local
  // fallback. Normalisation strips ports and any proxy chain.
  const host = normalizeHost(headersList.get("x-forwarded-host") ?? headersList.get("host"));

  const subdomainSlug = tenantSlugCandidates(host)[0] ?? null;
  const overrideSlug = devTenantSlugOverride();

  // Build the WHERE from whichever signals are actually present, so an
  // apex-domain request does not issue a pointless query.
  const conditions = [];
  if (host) conditions.push(and(
    eq(tenants.customDomain, host),
    eq(tenants.customDomainVerified, true),
    eq(tenants.sslEnabled, true),
  ));
  if (subdomainSlug) conditions.push(and(eq(tenants.slug, subdomainSlug), eq(tenants.isActive, true)));
  if (overrideSlug) conditions.push(and(eq(tenants.slug, overrideSlug), eq(tenants.isActive, true)));

  if (conditions.length === 0) return null;

  // Selecting customDomain lets us resolve the custom-domain / slug collision
  // deterministically rather than trusting row order.
  const rows = await db
    .select({ id: tenants.id, slug: tenants.slug, customDomain: tenants.customDomain })
    .from(tenants)
    .where(or(...conditions))
    .limit(3);

  if (rows.length === 0) return null;

  const chosen =
    rows.find((r) => host && r.customDomain === host) ??
    rows.find((r) => subdomainSlug && r.slug === subdomainSlug) ??
    rows.find((r) => overrideSlug && r.slug === overrideSlug) ??
    rows[0];

  return { tenantId: chosen.id, slug: chosen.slug };
}

const NO_TENANT_MESSAGE =
  "No tenant resolved for this request host. Public pages are tenant-scoped; " +
  "access them via the tenant subdomain or set PUBLIC_TENANT_SLUG in development.";

/**
 * Convenience wrapper for the common "scope a query to the public tenant" case.
 * Throws when there is no tenant context, so an unscoped read cannot be
 * forgotten at a call site.
 */
export async function requirePublicTenantId(): Promise<string> {
  const ctx = await getPublicTenantContext();
  if (!ctx) throw new Error(NO_TENANT_MESSAGE);
  return ctx.tenantId;
}

/** Same as `requirePublicTenantId` but also returns the slug. */
export async function requirePublicTenant(): Promise<PublicTenantContext> {
  const ctx = await getPublicTenantContext();
  if (!ctx) throw new Error(NO_TENANT_MESSAGE);
  return ctx;
}
