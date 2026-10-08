import type { DnsProvider } from "./types";
import { ManualDnsProvider } from "./providers/manual";
import { CloudflareDnsProvider } from "./providers/cloudflare";

export type DnsProviderKind = "manual" | "cloudflare" | "route53";

let cachedProvider: DnsProvider | null = null;

/**
 * Resolve and cache the DNS provider from environment variables.
 *
 * Resolution order:
 *   1. If CLOUDFLARE_API_TOKEN is set → CloudflareDnsProvider
 *   2. Otherwise → ManualDnsProvider (returns instructions, no API calls)
 *
 * Future: add Route53, DigitalOcean, etc. by extending this switch.
 *
 * The provider is cached at module scope after first resolution so repeated
 * calls don't re-read env or re-instantiate clients. Use `resetDnsProvider()`
 * in tests to force re-resolution.
 */
export function getDnsProvider(): DnsProvider {
  if (cachedProvider) return cachedProvider;

  const kind = (process.env.DNS_PROVIDER || "").toLowerCase();

  if (kind === "cloudflare" || process.env.CLOUDFLARE_API_TOKEN) {
    cachedProvider = new CloudflareDnsProvider({
      apiToken: process.env.CLOUDFLARE_API_TOKEN!,
      zoneId: process.env.CLOUDFLARE_ZONE_ID,
    });
    return cachedProvider;
  }

  // Default — no provider configured, return manual instructions.
  cachedProvider = new ManualDnsProvider();
  return cachedProvider;
}

/** Reset the cached provider (useful in tests). */
export function resetDnsProvider(): void {
  cachedProvider = null;
}

/** What kind of provider is currently configured? */
export function getDnsProviderKind(): DnsProviderKind {
  if (process.env.DNS_PROVIDER === "route53" || process.env.AWS_ACCESS_KEY_ID) {
    return "route53";
  }
  if (process.env.DNS_PROVIDER === "cloudflare" || process.env.CLOUDFLARE_API_TOKEN) {
    return "cloudflare";
  }
  return "manual";
}
