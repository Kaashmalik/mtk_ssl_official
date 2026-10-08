import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { db } from "@mtk/database";
import { tenants, emailDomainVerifications } from "@mtk/database";
import { eq, and } from "drizzle-orm";
import { isSuperAdmin } from "@/lib/super-admin";
import dns from "dns";
import { generateKeyPairSync } from "crypto";
import { captureError, getRequestLogger } from "@mtk/observability";

/**
 * GET - Check email domain verification status
 */
export async function GET(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const isAdmin = await isSuperAdmin();
    if (!isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const searchParams = request.nextUrl.searchParams;
    const domain = searchParams.get("domain");
    const tenantId = searchParams.get("tenantId");

    if (!domain || !tenantId) {
      return NextResponse.json({ error: "Domain and tenantId required" }, { status: 400 });
    }

    // Get tenant
    const tenant = await db
      .select()
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);

    if (tenant.length === 0) {
      return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
    }

    // Get email verification
    const verification = await db
      .select()
      .from(emailDomainVerifications)
      .where(
        and(
          eq(emailDomainVerifications.tenantId, tenant[0].id),
          eq(emailDomainVerifications.domain, domain)
        )
      )
      .limit(1);

    if (verification.length === 0) {
      return NextResponse.json({ error: "Verification not found" }, { status: 404 });
    }

    // Check DNS records (simplified)
    const isVerified = await checkEmailDnsRecords(domain, verification[0]);

    if (isVerified && verification[0].status !== "verified") {
      await db
        .update(emailDomainVerifications)
        .set({
          status: "verified",
          verifiedAt: new Date(),
          lastCheckedAt: new Date(),
        })
        .where(eq(emailDomainVerifications.id, verification[0].id));

      await db
        .update(tenants)
        .set({ emailDomainVerified: true })
        .where(eq(tenants.id, tenant[0].id));
    }

    const updated = await db
      .select()
      .from(emailDomainVerifications)
      .where(eq(emailDomainVerifications.id, verification[0].id))
      .limit(1);

    return NextResponse.json(updated[0]);
  } catch (error) {
    getRequestLogger().error("Error checking email verification", error);
    await captureError(error, {
      level: "error",
      tags: { source: "email-verify", method: "GET" },
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST - Initiate email domain verification
 */
export async function POST(request: NextRequest) {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const isAdmin = await isSuperAdmin();
    if (!isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const { domain, senderEmail, tenantId } = body;

    if (!domain || !senderEmail || !tenantId) {
      return NextResponse.json(
        { error: "Domain, sender email, and tenantId required" },
        { status: 400 }
      );
    }

    // Get tenant
    const tenant = await db
      .select()
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);

    if (tenant.length === 0) {
      return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
    }

    // Check if enterprise plan
    if (tenant[0].plan !== "enterprise") {
      return NextResponse.json(
        { error: "Custom email domain requires Enterprise plan" },
        { status: 403 }
      );
    }

    // Generate DKIM key pair (RSA 2048).
    // The PUBLIC key goes into the DNS TXT record (visible to all).
    // The PRIVATE key is stored so the mail-sending service can DKIM-sign
    // outbound messages for this domain. Previously the private key was
    // discarded, making the DKIM record useless for actual signing.
    const dkimSelector = "default";
    const { dkimPublicKeyRecord, dkimPrivateKeyPem } = generateDkimKeyPair();

    // Generate SPF record
    const spfRecord = `v=spf1 include:_spf.ssl.mtkcodex.site ~all`;

    // Generate DMARC record
    const dmarcRecord = `v=DMARC1; p=none; rua=mailto:dmarc@ssl.mtkcodex.site`;

    const verificationData = {
      tenantId: tenant[0].id,
      domain,
      senderEmail,
      dkimPublicKey: dkimPublicKeyRecord,
      dkimPrivateKey: dkimPrivateKeyPem,
      dkimSelector,
      spfRecord,
      dmarcRecord,
      status: "pending" as const,
      expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days
    };

    const existing = await db
      .select()
      .from(emailDomainVerifications)
      .where(
        and(
          eq(emailDomainVerifications.tenantId, tenant[0].id),
          eq(emailDomainVerifications.domain, domain)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(emailDomainVerifications)
        .set(verificationData)
        .where(eq(emailDomainVerifications.id, existing[0].id));
    } else {
      await db.insert(emailDomainVerifications).values(verificationData);
    }

    const verification = await db
      .select()
      .from(emailDomainVerifications)
      .where(
        and(
          eq(emailDomainVerifications.tenantId, tenant[0].id),
          eq(emailDomainVerifications.domain, domain)
        )
      )
      .limit(1);

    return NextResponse.json(verification[0]);
  } catch (error) {
    getRequestLogger().error("Error initiating email verification", error);
    await captureError(error, {
      level: "error",
      tags: { source: "email-verify", method: "POST" },
    });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * Check email DNS records (simplified)
 */
async function checkEmailDnsRecords(
  domain: string,
  verification: typeof emailDomainVerifications.$inferSelect
): Promise<boolean> {
  const log = getRequestLogger();
  try {
    const spfExpected = verification.spfRecord;
    const dmarcExpected = verification.dmarcRecord;
    const dkimExpected = verification.dkimPublicKey;
    const dkimSelector = verification.dkimSelector || "default";

    // 1. Resolve SPF on root domain
    let spfOk = false;
    if (spfExpected) {
      try {
        const spfRecords = await dns.promises.resolveTxt(domain);
        spfOk = spfRecords.some((record) =>
          record.some((val) => val === spfExpected || val.includes(spfExpected))
        );
      } catch (err) {
        log.warn("SPF check failed", { domain, error: err instanceof Error ? err.message : err });
      }
    }

    // 2. Resolve DMARC on _dmarc.domain
    let dmarcOk = false;
    if (dmarcExpected) {
      try {
        const dmarcRecords = await dns.promises.resolveTxt(`_dmarc.${domain}`);
        dmarcOk = dmarcRecords.some((record) =>
          record.some((val) => val === dmarcExpected || val.includes(dmarcExpected))
        );
      } catch (err) {
        log.warn("DMARC check failed", { domain, error: err instanceof Error ? err.message : err });
      }
    }

    // 3. Resolve DKIM on selector._domainkey.domain
    let dkimOk = false;
    if (dkimExpected) {
      try {
        const dkimRecords = await dns.promises.resolveTxt(`${dkimSelector}._domainkey.${domain}`);
        dkimOk = dkimRecords.some((record) =>
          record.some((val) => val === dkimExpected || val.includes(dkimExpected))
        );
      } catch (err) {
        log.warn("DKIM check failed", { domain, selector: dkimSelector, error: err instanceof Error ? err.message : err });
      }
    }

    log.debug("Email DNS record check", { domain, spfOk, dmarcOk, dkimOk });
    return spfOk && dmarcOk && dkimOk;
  } catch (error) {
    log.error("Email DNS records verification failed", error, { domain });
    return false;
  }
}

/**
 * Generate a DKIM RSA key pair.
 *
 * Returns:
 *   - dkimPublicKeyRecord: the TXT record value to publish at
 *     `<selector>._domainkey.<domain>` (e.g. "v=DKIM1; k=rsa; p=...").
 *   - dkimPrivateKeyPem: the PEM-encoded private key the mail service uses
 *     to sign outbound messages.
 *
 * SECURITY: the private key MUST be treated as a secret. In production it
 * should be encrypted at rest (KMS/Vault envelope) rather than stored as
 * plaintext in the DB — see migration 019 for the column and the security
 * note about hardening.
 */
function generateDkimKeyPair(): {
  dkimPublicKeyRecord: string;
  dkimPrivateKeyPem: string;
} {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: {
      type: "spki",
      format: "pem",
    },
    privateKeyEncoding: {
      type: "pkcs8",
      format: "pem",
    },
  });

  const rawPublicKey = publicKey
    .replace(/-----BEGIN PUBLIC KEY-----/, "")
    .replace(/-----END PUBLIC KEY-----/, "")
    .replace(/\s+/g, "");

  return {
    dkimPublicKeyRecord: `v=DKIM1; k=rsa; p=${rawPublicKey}`,
    dkimPrivateKeyPem: privateKey,
  };
}

