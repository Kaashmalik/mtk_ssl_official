import { promises as dnsPromises } from "node:dns";
import type {
  DnsProvider,
  DnsRecordSpec,
  CreatedDnsRecord,
} from "../types";

/**
 * Cloudflare DNS provider.
 *
 * Uses the Cloudflare REST API directly (fetch) to avoid pulling the full
 * `cloudflare` SDK into every consumer. Authenticated via an API token
 * scoped to `Zone:DNS:Edit` on the relevant zones.
 *
 * Required env:
 *   CLOUDFLARE_API_TOKEN — API token with Zone:DNS:Edit permission
 *   CLOUDFLARE_ZONE_ID   — (optional) default zone id; otherwise resolved by name
 *
 * The Cloudflare API:
 *   POST   /zones/{zone_id}/dns_records          → create
 *   DELETE /zones/{zone_id}/dns_records/{record_id} → delete
 *   GET    /zones/{zone_id}/dns_records?type=TXT&name=... → lookup
 */

const CF_API_BASE = "https://api.cloudflare.com/client/v4";

interface CloudflareResponse<T> {
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  messages: Array<{ code: number; message: string }>;
  result: T | null;
}

interface CloudflareDnsRecord {
  id: string;
  type: string;
  name: string;
  content: string;
  ttl: number;
  zone_id: string;
}

export class CloudflareDnsProvider implements DnsProvider {
  readonly name = "cloudflare";
  readonly automated = true;

  private readonly apiToken: string;
  private readonly defaultZoneId?: string;

  constructor(opts: { apiToken: string; zoneId?: string }) {
    if (!opts.apiToken) {
      throw new Error("CloudflareDnsProvider: apiToken is required");
    }
    this.apiToken = opts.apiToken;
    this.defaultZoneId = opts.zoneId;
  }

  private async fetchJson<T>(
    path: string,
    init: RequestInit = {}
  ): Promise<CloudflareResponse<T>> {
    const res = await fetch(`${CF_API_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
    });
    return (await res.json()) as CloudflareResponse<T>;
  }

  /**
   * Resolve the Cloudflare zone id for a given record name.
   * Uses the configured default if present; otherwise queries the API.
   */
  private async resolveZoneId(name: string, zoneName?: string): Promise<string> {
    if (this.defaultZoneId && !zoneName) return this.defaultZoneId;

    // Derive the zone apex from the record name or explicit zoneName.
    const apex = zoneName ?? deriveApex(name);
    const res = await this.fetchJson<CloudflareDnsRecord[]>(
      `/zones?name=${encodeURIComponent(apex)}`
    );
    if (!res.success || !res.result || res.result.length === 0) {
      throw new Error(`Cloudflare zone not found for apex "${apex}"`);
    }
    return res.result[0].zone_id;
  }

  async createRecord(spec: DnsRecordSpec): Promise<CreatedDnsRecord> {
    const zoneId = await this.resolveZoneId(spec.name, spec.zoneName);
    const name = spec.name.endsWith(".") ? spec.name.slice(0, -1) : spec.name;

    const body: Record<string, unknown> = {
      type: spec.type,
      name,
      content: spec.value,
      ttl: spec.ttl ?? 300,
      // Cloudflare proxies HTTP(S) traffic; TXT/_acme-challenge must NOT be proxied.
      proxied: false,
    };

    const res = await this.fetchJson<CloudflareDnsRecord>(
      `/zones/${zoneId}/dns_records`,
      {
        method: "POST",
        body: JSON.stringify(body),
      }
    );

    if (!res.success || !res.result) {
      const msg = res.errors?.[0]?.message ?? "Unknown Cloudflare error";
      throw new Error(`Cloudflare createRecord failed: ${msg}`);
    }

    return {
      recordId: res.result.id,
      name: res.result.name,
      type: spec.type,
      value: spec.value,
      ttl: res.result.ttl,
      zoneName: spec.zoneName,
    };
  }

  async deleteRecord(recordId: string): Promise<void> {
    // recordId is the Cloudflare DNS record id. We need the zone id too;
    // fetch the record first to get it.
    let zoneId = this.defaultZoneId;
    if (!zoneId) {
      const lookup = await this.fetchJson<CloudflareDnsRecord>(
        `/zones/-/dns_records/${recordId}`
      );
      zoneId = lookup.result?.zone_id;
      if (!zoneId) {
        throw new Error(
          `Cloudflare deleteRecord: could not resolve zone for record ${recordId}`
        );
      }
    }

    const res = await this.fetchJson<unknown>(
      `/zones/${zoneId}/dns_records/${recordId}`,
      { method: "DELETE" }
    );
    if (!res.success) {
      const msg = res.errors?.[0]?.message ?? "Unknown Cloudflare error";
      // Idempotent: if the record is already gone, don't fail.
      if (!msg.toLowerCase().includes("not found")) {
        throw new Error(`Cloudflare deleteRecord failed: ${msg}`);
      }
    }
  }

  async getTxtRecords(name: string): Promise<string[]> {
    // Prefer live DNS resolution (faster, hits resolvers, sees propagation).
    try {
      const records = await dnsPromises.resolveTxt(name);
      return records.map((chunks) => chunks.join(""));
    } catch {
      return [];
    }
  }
}

/**
 * Derive the zone apex from a record name by taking the last two labels.
 * `_acme-challenge.foo.example.com` → `example.com`
 * `example.com` → `example.com`
 */
function deriveApex(name: string): string {
  const n = name.endsWith(".") ? name.slice(0, -1) : name;
  const parts = n.split(".");
  if (parts.length <= 2) return n;
  return parts.slice(-2).join(".");
}
