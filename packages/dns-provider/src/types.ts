/**
 * DNS Provider abstraction.
 *
 * The white-label automation needs to programmatically create and remove
 * TXT records (for ACME DNS-01 challenges, DKIM, SPF, DMARC) and A/CNAME
 * records (for custom-domain routing). Different deployments use different
 * DNS providers (Cloudflare, Route53, manual). This package provides:
 *
 *   - `DnsProvider` interface (createRecord / deleteRecord / getRecord)
 *   - `CloudflareDnsProvider` — real Cloudflare API implementation
 *   - `ManualDnsProvider` — returns instructions for a human to apply
 *   - `getDnsProvider()` — factory that reads env vars and returns the right one
 *
 * SECURITY: this package never persists secrets. API tokens come from env.
 */

export type DnsRecordType = "TXT" | "A" | "CNAME" | "MX" | "AAAA";

export interface DnsRecordSpec {
  /** Fully-qualified record name, e.g. `_acme-challenge.example.com`. */
  name: string;
  type: DnsRecordType;
  /** Record value (for TXT this is the string; for A/CNAME the target). */
  value: string;
  /** TTL in seconds. Default 300 (5 min) — short for challenges. */
  ttl?: number;
  /** Optional Cloudflare zone override (if name spans multiple zones). */
  zoneName?: string;
}

export interface CreatedDnsRecord extends DnsRecordSpec {
  /** Provider-internal record id, needed to delete it later. */
  recordId: string;
}

export interface ManualRecordInstruction extends DnsRecordSpec {
  /**
   * When the provider is "manual" (no API access), the caller surfaces these
   * human-readable instructions to the tenant, who adds the record by hand.
   */
  instruction: string;
  /** The record name the tenant should enter (often just the subdomain part). */
  hostLabel: string;
}

export interface DnsProvider {
  /** Stable identifier: "cloudflare" | "manual" | "route53" | etc. */
  readonly name: string;
  /** True when records are written via API; false when they're manual. */
  readonly automated: boolean;

  /**
   * Create a DNS record. For manual providers this returns an instruction
   * object (no actual write happens).
   */
  createRecord(spec: DnsRecordSpec): Promise<CreatedDnsRecord | ManualRecordInstruction>;

  /**
   * Delete a DNS record by id (returned from createRecord).
   * Manual providers are no-ops (the human removes it).
   */
  deleteRecord(recordId: string): Promise<void>;

  /**
   * Read TXT records for a name. Used to verify propagation.
   * Returns the joined TXT values (DNS TXT records are arrays of chunks).
   */
  getTxtRecords(name: string): Promise<string[]>;
}

export function isManualInstruction(
  result: CreatedDnsRecord | ManualRecordInstruction
): result is ManualRecordInstruction {
  return (result as ManualRecordInstruction).instruction !== undefined;
}

export function isCreatedRecord(
  result: CreatedDnsRecord | ManualRecordInstruction
): result is CreatedDnsRecord {
  return (result as CreatedDnsRecord).recordId !== undefined;
}
