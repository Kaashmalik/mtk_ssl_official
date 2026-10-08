import { Injectable, Logger } from "@nestjs/common";
import { X509Certificate } from "node:crypto";
import { db } from "@mtk/database";
import { sslCertificates, tenants, dnsVerifications } from "@mtk/database";
import { eq, and, lt } from "drizzle-orm";
import * as acme from "acme-client";
import * as fs from "fs/promises";
import * as path from "path";
import {
  getDnsProvider,
  waitForTxtRecord,
  isManualInstruction,
  type CreatedDnsRecord,
} from "@mtk/dns-provider";

/**
 * SSL certificate issuance via Let's Encrypt (ACME).
 *
 * BUGS FIXED (Phase 3b):
 *  1. DNS-01 challenge was only logged — never written to a DNS provider.
 *     Now uses @mtk/dns-provider to actually create the _acme-challenge TXT
 *     record (via Cloudflare API when configured, or returns manual
 *     instructions when no provider is set).
 *  2. extractExpiryDate() returned a hardcoded 90 days. Now parses the real
 *     X.509 certificate with Node's crypto.X509Certificate.
 *  3. Certs were written to <cwd>/ssl-certs — fragile across serverless /
 *     containers. Now honours CERT_STORAGE_DIR and warns if unset.
 *
 * RENEWAL: renewExpiringCertificates() is now callable from a cron route
 * (Phase 3c adds the Vercel Cron job).
 */
@Injectable()
export class SslService {
  private readonly logger = new Logger(SslService.name);
  private acmeClient: acme.Client | null = null;
  private readonly acmeInitPromise: Promise<void>;

  constructor() {
    // Don't block construction on ACME init — it may fail in dev where the
    // account key directory isn't writable. Store the promise so callers can
    // await readiness on demand.
    this.acmeInitPromise = this.initializeAcmeClient().catch((err: unknown) => {
      this.logger.warn(
        `ACME client init failed: ${err instanceof Error ? err.message : err}`
      );
    });
  }

  /**
   * Initialize Let's Encrypt ACME client.
   */
  private async initializeAcmeClient(): Promise<void> {
    try {
      const directoryUrl =
        process.env.ACME_ENVIRONMENT === "production"
          ? acme.directory.letsencrypt.production
          : acme.directory.letsencrypt.staging;

      // Account key directory is configurable; default to <cwd>/ssl-keys.
      const keyDir = process.env.ACME_KEY_DIR || path.join(process.cwd(), "ssl-keys");
      const accountKeyPath = path.join(keyDir, "account-key.pem");

      let accountKey: Buffer;
      try {
        accountKey = await fs.readFile(accountKeyPath);
      } catch {
        // Generate a new account key on first run and persist it.
        const accountKeyPair = await acme.crypto.createPrivateKey();
        await fs.mkdir(keyDir, { recursive: true });
        await fs.writeFile(accountKeyPath, accountKeyPair, { mode: 0o600 });
        accountKey = accountKeyPair;
        this.logger.log(`Generated new ACME account key at ${accountKeyPath}`);
      }

      this.acmeClient = new acme.Client({
        directoryUrl,
        accountKey,
      });

      this.logger.log("ACME client initialized");
    } catch (error) {
      this.logger.error(
        "Failed to initialize ACME client",
        error instanceof Error ? error.stack : error
      );
    }
  }

  private async ensureAcmeReady(): Promise<acme.Client> {
    await this.acmeInitPromise;
    if (!this.acmeClient) {
      throw new Error(
        "ACME client is not initialised. Check ACME_ENVIRONMENT and write access to the account-key directory."
      );
    }
    return this.acmeClient;
  }

  /**
   * Issue SSL certificate for a domain.
   *
   * Pre-requisite: the domain's DNS ownership must already be verified
   * (a row in dns_verifications with status='verified').
   */
  async issueCertificate(
    tenantId: string,
    domain: string
  ): Promise<typeof sslCertificates.$inferSelect> {
    const client = await this.ensureAcmeReady();

    // --- Check DNS verification pre-requisite ---
    const dnsVerification = await db
      .select()
      .from(dnsVerifications)
      .where(
        and(
          eq(dnsVerifications.tenantId, tenantId),
          eq(dnsVerifications.domain, domain),
          eq(dnsVerifications.status, "verified")
        )
      )
      .limit(1);

    if (dnsVerification.length === 0) {
      throw new Error("DNS verification required before SSL certificate issuance");
    }

    // --- Find or create the certificate record ---
    const existing = await db
      .select()
      .from(sslCertificates)
      .where(and(eq(sslCertificates.tenantId, tenantId), eq(sslCertificates.domain, domain)))
      .limit(1);

    if (existing.length > 0 && existing[0].status === "active") {
      return existing[0];
    }

    let certificateId: string;
    const pendingData = {
      tenantId,
      domain,
      status: "pending" as const,
    };

    if (existing.length > 0) {
      const [updated] = await db
        .update(sslCertificates)
        .set({ ...pendingData, errorMessage: null })
        .where(eq(sslCertificates.id, existing[0].id))
        .returning({ id: sslCertificates.id });
      certificateId = updated.id;
    } else {
      const [inserted] = await db
        .insert(sslCertificates)
        .values(pendingData)
        .returning({ id: sslCertificates.id });
      certificateId = inserted.id;
    }

    try {
      // --- Generate CSR ---
      const [key, csr] = await acme.crypto.createCsr({ commonName: domain });

      // --- Create ACME order ---
      const order = await client.createOrder({
        identifiers: [{ type: "dns", value: domain }],
      });

      // --- Complete DNS-01 challenge for each authorization ---
      const authorizations = await client.getAuthorizations(order);
      const createdChallengeRecords: CreatedDnsRecord[] = [];

      try {
        for (const authz of authorizations) {
          if (authz.status === "valid") continue;

          // Prefer DNS-01 (works for wildcard, doesn't require serving HTTP).
          const dnsChallenge = authz.challenges.find((c: { type: string }) => c.type === "dns-01");
          if (!dnsChallenge) {
            throw new Error("DNS-01 challenge not offered by the ACME server");
          }

          const dnsKeyAuthorization = await client.getChallengeKeyAuthorization(dnsChallenge);
          const challengeHost = `_acme-challenge.${domain}`;
          this.logger.log(`Creating DNS-01 challenge TXT record at ${challengeHost}`);

          // --- Write the TXT record via the DNS provider ---
          const provider = getDnsProvider();
          const recordResult = await provider.createRecord({
            name: challengeHost,
            type: "TXT",
            value: dnsKeyAuthorization,
            ttl: 120,
            zoneName: domain,
          });

          if (isManualInstruction(recordResult)) {
            // No API access — the tenant must add the record by hand.
            // We surface the instruction in the error so the admin UI can
            // display it; the order stays pending and can be retried.
            throw new Error(
              `MANUAL_DNS_REQUIRED: ${recordResult.instruction}. ` +
                `Add this record, then re-run SSL issuance.`
            );
          }

          createdChallengeRecords.push(recordResult);

          // --- Wait for DNS propagation before asking ACME to verify ---
          const propagated = await waitForTxtRecord(
            provider,
            challengeHost,
            dnsKeyAuthorization,
            {
              maxAttempts: 24, // 24 × 5s = 2 minutes max
              intervalMs: 5000,
              onAttempt: (n: number, found: boolean) =>
                this.logger.debug(`DNS propagation poll ${n}: ${found ? "found" : "not yet"}`),
            }
          );

          if (!propagated) {
            this.logger.warn(
              `DNS propagation not yet visible for ${challengeHost}; asking ACME to verify anyway.`
            );
          }

          // --- Tell the ACME server we're ready for validation ---
          await client.completeChallenge(dnsChallenge);
          await client.waitForValidStatus(dnsChallenge);
        }
      } finally {
        // --- Clean up challenge TXT records regardless of outcome ---
        // Leaving them in place is a security smell and clutters the zone.
        const provider = getDnsProvider();
        await Promise.allSettled(
          createdChallengeRecords.map((r) => provider.deleteRecord(r.recordId))
        );
      }

      // --- Finalize order + download certificate ---
      await client.finalizeOrder(order, csr);
      const cert = await client.getCertificate(order);

      // --- Persist certificate + private key ---
      const { certPath, keyPath } = await this.storeCertificate(tenantId, domain, cert, key);

      // --- Parse real expiry date from the X.509 certificate ---
      const expiresAt = this.extractExpiryDate(cert);

      await db
        .update(sslCertificates)
        .set({
          certificateUrl: certPath,
          privateKeyUrl: keyPath,
          status: "active",
          issuedAt: new Date(),
          expiresAt,
          lastRenewedAt: new Date(),
          renewalAttempts: 0,
          errorMessage: null,
        })
        .where(eq(sslCertificates.id, certificateId));

      await db
        .update(tenants)
        .set({ sslEnabled: true })
        .where(eq(tenants.id, tenantId));

      this.logger.log(
        `SSL certificate issued for ${domain} (expires ${expiresAt.toISOString()})`
      );

      const [updated] = await db
        .select()
        .from(sslCertificates)
        .where(eq(sslCertificates.id, certificateId))
        .limit(1);

      return updated;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to issue SSL certificate for ${domain}: ${message}`);

      await db
        .update(sslCertificates)
        .set({
          status: "failed",
          errorMessage: message.slice(0, 1000),
        })
        .where(eq(sslCertificates.id, certificateId));

      throw error;
    }
  }

  /**
   * Renew certificates that are expiring soon.
   * Called by the Vercel Cron job (Phase 3c) — POST /ssl/renew (CRON_SECRET gated).
   */
  async renewExpiringCertificates(): Promise<{ renewed: number; failed: number }> {
    const thirtyDaysFromNow = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const expiring = await db
      .select()
      .from(sslCertificates)
      .where(
        and(
          eq(sslCertificates.status, "active"),
          eq(sslCertificates.autoRenew, true),
          lt(sslCertificates.expiresAt, thirtyDaysFromNow)
        )
      );

    let renewed = 0;
    let failed = 0;

    for (const cert of expiring) {
      try {
        this.logger.log(`Renewing certificate for ${cert.domain}`);
        await this.issueCertificate(cert.tenantId, cert.domain);
        renewed++;
      } catch (error) {
        failed++;
        // Bump the retry counter so we can alert on certs stuck in a fail loop.
        await db
          .update(sslCertificates)
          .set({
            renewalAttempts: (cert.renewalAttempts ?? 0) + 1,
            errorMessage:
              error instanceof Error ? error.message.slice(0, 1000) : String(error),
          })
          .where(eq(sslCertificates.id, cert.id));
        this.logger.error(
          `Failed to renew certificate for ${cert.domain}`,
          error instanceof Error ? error.stack : error
        );
      }
    }

    this.logger.log(`Renewal sweep complete: ${renewed} renewed, ${failed} failed`);
    return { renewed, failed };
  }

  /**
   * Persist the issued certificate and private key to disk.
   *
   * Honours CERT_STORAGE_DIR (falls back to <cwd>/ssl-certs).
   * NOTE: the private key is written with mode 0o600. For encrypted-at-rest
   * storage (KMS, Vault, Supabase Storage + envelope encryption), wrap this
   * method in a subclass or replace it. The schema's privateKeyUrl column
   * holds whatever opaque reference the storage backend uses.
   */
  private async storeCertificate(
    tenantId: string,
    domain: string,
    cert: string,
    key: Buffer | string
  ): Promise<{ certPath: string; keyPath: string }> {
    const baseDir = process.env.CERT_STORAGE_DIR || path.join(process.cwd(), "ssl-certs");
    if (!process.env.CERT_STORAGE_DIR) {
      this.logger.warn(
        "CERT_STORAGE_DIR is not set — writing certificates to <cwd>/ssl-certs. " +
          "Set CERT_STORAGE_DIR to a persistent, encrypted volume in production."
      );
    }

    const certDir = path.join(baseDir, tenantId);
    await fs.mkdir(certDir, { recursive: true });

    const certPath = path.join(certDir, `${domain}.crt`);
    const keyPath = path.join(certDir, `${domain}.key`);

    await fs.writeFile(certPath, cert, { mode: 0o644 });
    await fs.writeFile(keyPath, key, { mode: 0o600 });

    return { certPath, keyPath };
  }

  /**
   * Parse the expiry date from a PEM-encoded X.509 certificate.
   *
   * Previously this returned a hardcoded 90 days, which caused renewals to
   * never fire (the DB thought certs lasted 90 days from whenever they were
   * saved, not the real Let's Encrypt expiry).
   */
  private extractExpiryDate(certPem: string): Date {
    try {
      // acme-client returns one or more PEM blocks concatenated.
      // X509Certificate parses the first one; that's the leaf cert.
      const x509 = new X509Certificate(certPem);
      const validTo = x509.validTo;
      const date = new Date(validTo);
      if (Number.isNaN(date.getTime())) {
        throw new Error(`Unparseable validTo: ${validTo}`);
      }
      return date;
    } catch (err) {
      this.logger.warn(
        `Failed to parse certificate expiry (${err instanceof Error ? err.message : err}). ` +
          "Falling back to 60-day estimate — renewal timing may be inaccurate."
      );
      // Conservative fallback: 60 days (shorter than LE's 90 so renewal fires earlier).
      return new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
    }
  }
}
