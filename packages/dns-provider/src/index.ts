// Core types
export {
  type DnsProvider,
  type DnsRecordSpec,
  type DnsRecordType,
  type CreatedDnsRecord,
  type ManualRecordInstruction,
  isManualInstruction,
  isCreatedRecord,
} from "./types";

// Factory + resolution
export {
  getDnsProvider,
  resetDnsProvider,
  getDnsProviderKind,
  type DnsProviderKind,
} from "./factory";

// Built-in providers (exported for direct instantiation / testing)
export { ManualDnsProvider } from "./providers/manual";
export { CloudflareDnsProvider } from "./providers/cloudflare";

// Propagation waiter
export { waitForTxtRecord, type WaitForRecordOptions } from "./wait";
