import { promises as dnsPromises } from "node:dns";
import type {
  DnsProvider,
  DnsRecordSpec,
  ManualRecordInstruction,
} from "../types";

/**
 * Manual DNS provider — for deployments without DNS API access.
 *
 * `createRecord` and `deleteRecord` are no-ops that return human-readable
 * instructions for the tenant to apply manually through their registrar/DNS
 * console. `getTxtRecords` does a live lookup so the rest of the pipeline
 * (propagation waiting) still works.
 *
 * This is the default when no provider credentials are configured.
 */
export class ManualDnsProvider implements DnsProvider {
  readonly name = "manual";
  readonly automated = false;

  async createRecord(
    spec: DnsRecordSpec
  ): Promise<ManualRecordInstruction> {
    // Derive the host label the tenant enters. Most DNS consoles expect the
    // record name relative to the zone apex, not fully-qualified.
    const hostLabel = deriveHostLabel(spec.name, spec.zoneName);

    return {
      ...spec,
      hostLabel,
      instruction: formatInstruction(spec, hostLabel),
    };
  }

  async deleteRecord(_recordId: string): Promise<void> {
    // No-op — the tenant removes the record themselves. The recordId passed
    // is the synthetic `manual:<name>:<type>` we assigned in createRecord.
    return;
  }

  async getTxtRecords(name: string): Promise<string[]> {
    try {
      const records = await dnsPromises.resolveTxt(name);
      // DNS TXT records come back as string[][] (each record is an array of
      // chunks that should be concatenated).
      return records.map((chunks) => chunks.join(""));
    } catch {
      return [];
    }
  }
}

/**
 * Strip the zone suffix from a FQDN to get the label the tenant enters.
 *   `_acme-challenge.example.com` with zone `example.com` → `_acme-challenge`
 *   `example.com` with zone `example.com` → `@` (apex)
 */
function deriveHostLabel(name: string, zoneName?: string): string {
  const n = name.endsWith(".") ? name.slice(0, -1) : name;
  if (!zoneName) {
    // Best-effort: assume the last two labels are the zone.
    const parts = n.split(".");
    if (parts.length <= 2) return "@";
    return parts.slice(0, -2).join(".");
  }
  const z = zoneName.endsWith(".") ? zoneName.slice(0, -1) : zoneName;
  if (n === z) return "@";
  if (n.endsWith(`.${z}`)) return n.slice(0, -(z.length + 1));
  return n;
}

function formatInstruction(spec: DnsRecordSpec, hostLabel: string): string {
  const ttl = spec.ttl ?? 300;
  switch (spec.type) {
    case "TXT":
      return `Add a TXT record: Host/Name = "${hostLabel}", Value = "${spec.value}", TTL = ${ttl}s`;
    case "A":
      return `Add an A record: Host/Name = "${hostLabel}", Value = ${spec.value}, TTL = ${ttl}s`;
    case "AAAA":
      return `Add an AAAA record: Host/Name = "${hostLabel}", Value = ${spec.value}, TTL = ${ttl}s`;
    case "CNAME":
      return `Add a CNAME record: Host/Name = "${hostLabel}", Target = ${spec.value}, TTL = ${ttl}s`;
    case "MX":
      return `Add an MX record: Host/Name = "${hostLabel}", Mail server = ${spec.value}, TTL = ${ttl}s`;
    default:
      return `Add a ${spec.type} record: Host/Name = "${hostLabel}", Value = "${spec.value}", TTL = ${ttl}s`;
  }
}
