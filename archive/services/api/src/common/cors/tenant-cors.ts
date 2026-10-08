import { corsOrigins, env } from "../../env";
import { db, tenants } from "@mtk/database";
import { and, eq, isNotNull } from "drizzle-orm";

let cachedOrigins = new Set<string>(corsOrigins);
let lastRefresh = 0;

function normalizeOrigin(origin: string) {
  return origin.trim().toLowerCase();
}

function allowSubdomain(origin: string) {
  if (!env.CORS_ALLOW_SUBDOMAIN) return false;
  try {
    const { hostname, protocol } = new URL(origin);
    if (protocol !== "https:" && protocol !== "http:") return false;
    return hostname.endsWith(".ssl.mtkcodex.site");
  } catch {
    return false;
  }
}

export async function refreshCorsOrigins() {
  const now = Date.now();
  if (now - lastRefresh < env.CORS_CACHE_SECONDS * 1000) return;

  lastRefresh = now;
  const base = new Set<string>(corsOrigins.map(normalizeOrigin));

  const customDomains = await db
    .select({ customDomain: tenants.customDomain })
    .from(tenants)
    .where(
      and(
        eq(tenants.isActive, true),
        eq(tenants.customDomainVerified, true),
        isNotNull(tenants.customDomain)
      )
    );

  for (const item of customDomains) {
    if (item.customDomain) {
      base.add(`https://${item.customDomain}`.toLowerCase());
      base.add(`http://${item.customDomain}`.toLowerCase());
    }
  }

  cachedOrigins = base;
}

export function isOriginAllowed(origin?: string): boolean {
  if (!origin) return true;
  const normalized = normalizeOrigin(origin);
  if (cachedOrigins.has(normalized)) return true;
  return allowSubdomain(normalized);
}