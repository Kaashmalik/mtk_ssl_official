import type { DnsProvider } from "./types";

export interface WaitForRecordOptions {
  /** Max polls. Default 12. */
  maxAttempts?: number;
  /** Delay between polls in ms. Default 5000 (12 × 5s = 60s max). */
  intervalMs?: number;
  /** Optional progress callback (attempt number, 1-indexed). */
  onAttempt?: (attempt: number, found: boolean) => void;
}

/**
 * Poll DNS until the expected TXT value is visible, or time out.
 *
 * Used after writing a DNS record (or instructing the tenant to add one) to
 * wait for global propagation before proceeding with ACME verification.
 *
 * Returns true if the value was observed, false on timeout.
 */
export async function waitForTxtRecord(
  provider: DnsProvider,
  name: string,
  expectedValue: string,
  opts: WaitForRecordOptions = {}
): Promise<boolean> {
  const maxAttempts = opts.maxAttempts ?? 12;
  const intervalMs = opts.intervalMs ?? 5000;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const records = await provider.getTxtRecords(name);
    const found = records.some(
      (r) => r === expectedValue || r.includes(expectedValue)
    );
    opts.onAttempt?.(attempt, found);
    if (found) return true;
    if (attempt < maxAttempts) {
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }
  return false;
}
