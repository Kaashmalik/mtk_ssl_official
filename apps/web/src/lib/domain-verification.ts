import dns from "dns"
import { randomBytes, generateKeyPairSync } from "crypto"
import { db, dnsVerifications, emailDomainVerifications, sslCertificates, tenants, users } from "@mtk/database"
import { and, eq } from "drizzle-orm"
import { isSuperAdmin } from "@/lib/super-admin"
import { getRequestLogger } from "@mtk/observability"

/**
 * Custom-domain trust primitives (DNS/SSL/email-domain verification) for the
 * white-label flow. HTTP responses are redacted through `toClientEmailVerification`:
 * the DKIM private key stays in the database where the mail-sending service
 * reads it — it is never needed client-side and must not leave the server.
 */

export type DnsVerification = typeof dnsVerifications.$inferSelect
export type EmailDomainVerification = typeof emailDomainVerifications.$inferSelect

/** Super admins can manage any league's domain; otherwise exactly its owner. */
export async function canManageTenantDomain(clerkUserId: string, tenantId: string): Promise<boolean> {
  if (await isSuperAdmin()) return true
  const [actor] = await db.select({ id: users.id }).from(users)
    .where(eq(users.clerkId, clerkUserId)).limit(1)
  if (!actor) return false
  const [tenant] = await db.select({ id: tenants.id }).from(tenants)
    .where(and(eq(tenants.id, tenantId), eq(tenants.ownerId, actor.id))).limit(1)
  return Boolean(tenant)
}

// ─── DNS (custom domain) verification ────────────────────────

export async function getDnsVerification(tenantId: string, domain: string): Promise<DnsVerification | null> {
  const [row] = await db
    .select()
    .from(dnsVerifications)
    .where(and(eq(dnsVerifications.tenantId, tenantId), eq(dnsVerifications.domain, domain)))
    .limit(1)
  return row ?? null
}

/**
 * Mint a fresh TXT verification token for the domain (7-day window) and
 * create-or-update the verification row. Minting rotates any previous token,
 * so only the instructions currently served to the owner can ever verify.
 */
export async function upsertDnsVerification(tenantId: string, domain: string): Promise<DnsVerification> {
  const verificationToken = randomBytes(16).toString("hex")
  const expectedValue = `ssl-verify-${verificationToken}`

  const verificationData = {
    tenantId,
    domain,
    verificationToken,
    verificationType: "txt",
    expectedValue,
    status: "pending" as const,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  }

  const existing = await getDnsVerification(tenantId, domain)
  if (existing) {
    const [row] = await db.update(dnsVerifications).set(verificationData)
      .where(eq(dnsVerifications.id, existing.id)).returning()
    return row
  }
  const [row] = await db.insert(dnsVerifications).values(verificationData).returning()
  return row
}

/** Resolve `_ssl-verify.<domain>` TXT and match the expected token. */
export async function checkDnsRecord(domain: string, type: string, expectedValue: string): Promise<boolean> {
  try {
    if (type.toLowerCase() === "txt") {
      const records = await dns.promises.resolveTxt(`_ssl-verify.${domain}`)
      return records.some((record) =>
        record.some((val) => val === expectedValue || val.includes(expectedValue)),
      )
    }
    return false
  } catch (error) {
    // dns.resolveTxt throws on no records / domain not found
    console.warn("DNS check failed or record not found for domain:", domain, error)
    return false
  }
}

/** Persist the verified transition on both the verification row and the tenant. */
export async function markDnsVerified(verificationId: string, tenantId: string, now: Date): Promise<void> {
  await db.update(dnsVerifications)
    .set({ status: "verified", verifiedAt: now, lastCheckedAt: now })
    .where(eq(dnsVerifications.id, verificationId))
  await db.update(tenants)
    .set({ customDomainVerified: true, customDomainVerifiedAt: now })
    .where(eq(tenants.id, tenantId))
}

export async function getDnsVerificationById(id: string): Promise<DnsVerification | null> {
  const [row] = await db.select().from(dnsVerifications).where(eq(dnsVerifications.id, id)).limit(1)
  return row ?? null
}

// ─── Email domain verification ───────────────────────────────

export async function getEmailVerification(tenantId: string, domain: string): Promise<EmailDomainVerification | null> {
  const [row] = await db
    .select()
    .from(emailDomainVerifications)
    .where(and(eq(emailDomainVerifications.tenantId, tenantId), eq(emailDomainVerifications.domain, domain)))
    .limit(1)
  return row ?? null
}

export type ClientEmailVerification = Omit<EmailDomainVerification, "dkimPrivateKey">

/** Strip the DKIM private key — it belongs to the mail service, not the client. */
export function toClientEmailVerification(row: EmailDomainVerification): ClientEmailVerification {
  const { dkimPrivateKey: _redacted, ...client } = row
  return client
}

/**
 * Generate (or rotate) a DKIM key pair and persist the email-domain
 * verification records.
 *
 * SECURITY: the private key MUST be treated as a secret. It is stored in the
 * DB for the mail-sending service; it is never returned over HTTP (see
 * `toClientEmailVerification`). In production it should be encrypted at rest
 * (KMS/Vault envelope) rather than plaintext — see migration 019.
 */
export async function upsertEmailVerification(input: {
  tenantId: string
  domain: string
  senderEmail: string
}): Promise<EmailDomainVerification> {
  const { tenantId, domain, senderEmail } = input
  const dkimSelector = "default"
  const { dkimPublicKeyRecord, dkimPrivateKeyPem } = generateDkimKeyPair()
  // Batch 149: the PLATFORM's sending domain is configuration, not code —
  // these per-tenant records tell the tenant's DNS to trust OUR mailer.
  // Today the verified Resend domain is still ssl.mtkcodex.site (the
  // fallbacks in otp.ts / notification-email.ts send from it), so the
  // default preserves the exact records generated before this refactor.
  // The moment Resend verifies cricketleague.tech, the cut is:
  //   PLATFORM_MAIL_DOMAIN=cricketleague.tech
  // (plus flipping the sending fallbacks via RESEND_FROM_EMAIL /
  // OTP_EMAIL_FROM) — never edit the default before that verification
  // exists, or every tenant SPF include points at an unverified domain.
  const platformMailDomain = process.env.PLATFORM_MAIL_DOMAIN || "ssl.mtkcodex.site"
  const spfRecord = `v=spf1 include:_spf.${platformMailDomain} ~all`
  const dmarcRecord = `v=DMARC1; p=none; rua=mailto:dmarc@${platformMailDomain}`

  const verificationData = {
    tenantId,
    domain,
    senderEmail,
    dkimPublicKey: dkimPublicKeyRecord,
    dkimPrivateKey: dkimPrivateKeyPem,
    dkimSelector,
    spfRecord,
    dmarcRecord,
    status: "pending" as const,
    expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
  }

  const existing = await getEmailVerification(tenantId, domain)
  if (existing) {
    const [row] = await db.update(emailDomainVerifications).set(verificationData)
      .where(eq(emailDomainVerifications.id, existing.id)).returning()
    return row
  }
  const [row] = await db.insert(emailDomainVerifications).values(verificationData).returning()
  return row
}

/**
 * Verify SPF (root domain), DMARC (`_dmarc.<domain>`) and DKIM
 * (`<selector>._domainkey.<domain>`) TXT records. Requires all three.
 */
export async function checkEmailDnsRecords(
  domain: string,
  verification: EmailDomainVerification,
): Promise<boolean> {
  const log = getRequestLogger()
  try {
    const spfExpected = verification.spfRecord
    const dmarcExpected = verification.dmarcRecord
    const dkimExpected = verification.dkimPublicKey
    const dkimSelector = verification.dkimSelector || "default"

    // 1. Resolve SPF on root domain
    let spfOk = false
    if (spfExpected) {
      try {
        const spfRecords = await dns.promises.resolveTxt(domain)
        spfOk = spfRecords.some((record) =>
          record.some((val) => val === spfExpected || val.includes(spfExpected)),
        )
      } catch (err) {
        log.warn("SPF check failed", { domain, error: err instanceof Error ? err.message : err })
      }
    }

    // 2. Resolve DMARC on _dmarc.domain
    let dmarcOk = false
    if (dmarcExpected) {
      try {
        const dmarcRecords = await dns.promises.resolveTxt(`_dmarc.${domain}`)
        dmarcOk = dmarcRecords.some((record) =>
          record.some((val) => val === dmarcExpected || val.includes(dmarcExpected)),
        )
      } catch (err) {
        log.warn("DMARC check failed", { domain, error: err instanceof Error ? err.message : err })
      }
    }

    // 3. Resolve DKIM on selector._domainkey.domain
    let dkimOk = false
    if (dkimExpected) {
      try {
        const dkimRecords = await dns.promises.resolveTxt(`${dkimSelector}._domainkey.${domain}`)
        dkimOk = dkimRecords.some((record) =>
          record.some((val) => val === dkimExpected || val.includes(dkimExpected)),
        )
      } catch (err) {
        log.warn("DKIM check failed", { domain, selector: dkimSelector, error: err instanceof Error ? err.message : err })
      }
    }

    log.debug("Email DNS record check", { domain, spfOk, dmarcOk, dkimOk })
    return spfOk && dmarcOk && dkimOk
  } catch (error) {
    log.error("Email DNS records verification failed", error, { domain })
    return false
  }
}

/** Persist the verified transition on both the verification row and the tenant. */
export async function markEmailVerified(verificationId: string, tenantId: string, now: Date): Promise<void> {
  await db.update(emailDomainVerifications)
    .set({ status: "verified", verifiedAt: now, lastCheckedAt: now })
    .where(eq(emailDomainVerifications.id, verificationId))
  await db.update(tenants)
    .set({ emailDomainVerified: true })
    .where(eq(tenants.id, tenantId))
}

/**
 * Generate a DKIM RSA 2048 key pair.
 *
 * Returns:
 *   - dkimPublicKeyRecord: the TXT record value to publish at
 *     `<selector>._domainkey.<domain>` (e.g. "v=DKIM1; k=rsa; p=...").
 *   - dkimPrivateKeyPem: the PEM-encoded private key the mail service uses
 *     to sign outbound messages.
 */
export function generateDkimKeyPair(): {
  dkimPublicKeyRecord: string
  dkimPrivateKeyPem: string
} {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  })

  const rawPublicKey = publicKey
    .replace(/-----BEGIN PUBLIC KEY-----/, "")
    .replace(/-----END PUBLIC KEY-----/, "")
    .replace(/\s+/g, "")

  return {
    dkimPublicKeyRecord: `v=DKIM1; k=rsa; p=${rawPublicKey}`,
    dkimPrivateKeyPem: privateKey,
  }
}

// ─── SSL certificate status ──────────────────────────────────

export async function getSslCertificate(tenantId: string, domain: string) {
  const [certificate] = await db
    .select()
    .from(sslCertificates)
    .where(and(eq(sslCertificates.tenantId, tenantId), eq(sslCertificates.domain, domain)))
    .limit(1)
  return certificate ?? null
}
