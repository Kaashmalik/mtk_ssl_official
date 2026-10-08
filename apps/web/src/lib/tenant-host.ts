/**
 * Pure host/tenant-slug parsing.
 *
 * Deliberately has NO database or Node imports so it can be used from the Edge
 * middleware bundle (`middleware.ts` cannot reach the DB) as well as from
 * server components. Keeping one implementation avoids the drift that already
 * existed between `middleware.getTenantFromHost` and `lib/tenant.getTenantFromRequest`.
 */

/** Host labels that identify the platform itself, never a tenant. */
const RESERVED_SUBDOMAINS = new Set(["www", "app", "admin", "api", "staging"]);

/**
 * Strips the port and normalises a Host header value.
 *
 * `x-forwarded-host` may carry a comma-separated proxy chain; only the first
 * entry is the origin the client actually asked for.
 */
export function normalizeHost(rawHost: string | null | undefined): string {
  if (!rawHost) return "";
  const first = rawHost.split(",")[0]?.trim() ?? "";
  // Bracketed IPv6 literals: [::1]:3000 — do not strip inside the brackets.
  const withoutPort = first.startsWith("[")
    ? first.replace(/^\[[^\]]*\]/, (m) => m).replace(/:\d+$/, "")
    : first.replace(/:\d+$/, "");
  return withoutPort.toLowerCase();
}

/**
 * Extracts candidate tenant slugs from a host, most specific first.
 *
 *   `ssl.mtkcodex.site`   -> ["ssl"]
 *   `www.ssl.example.com` -> ["ssl"]      (leading reserved label skipped)
 *   `ssl.localhost:3001`  -> ["ssl"]      (local dev with a tenant subdomain)
 *   `localhost:3001`      -> []           (no tenant context)
 *   `mtkcodex.site`       -> []           (apex: `mtkcodex` is not a tenant)
 *
 * The apex case matters: naively taking `parts[0]` would yield "mtkcodex" for
 * the bare domain and could resolve an unrelated tenant.
 */
export function tenantSlugCandidates(normalizedHost: string): string[] {
  if (!normalizedHost) return [];

  const labels = normalizedHost.split(".").filter(Boolean);
  if (labels.length < 2) return [];

  // `ssl.localhost` — two labels where the parent is localhost.
  if (labels.length === 2) {
    if (labels[1] !== "localhost") return [];
    return RESERVED_SUBDOMAINS.has(labels[0]) ? [] : [labels[0]];
  }

  // Three or more labels. Skip reserved leading labels (`www.`, `app.`, ...).
  let i = 0;
  while (i < labels.length && RESERVED_SUBDOMAINS.has(labels[i])) i++;
  if (i >= labels.length) return [];

  // A label is only a subdomain when at least two labels remain after it — the
  // registrable domain plus a TLD. This is what distinguishes `ssl.ssl.site`
  // (tenant "ssl") from the apex `www.ssl.site`, where "ssl" is the domain
  // itself and must not be resolved as a tenant.
  if (labels.length - i - 1 < 2) return [];

  return [labels[i]];
}

/**
 * Convenience wrapper: normalised host in, first slug candidate out.
 * Returns null when the host carries no tenant context.
 */
export function tenantSlugFromHost(rawHost: string | null | undefined): string | null {
  const candidates = tenantSlugCandidates(normalizeHost(rawHost));
  return candidates[0] ?? null;
}
