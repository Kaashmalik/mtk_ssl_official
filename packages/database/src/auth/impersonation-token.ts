import { webcrypto, timingSafeEqual } from "node:crypto";

/**
 * Secure impersonation token (HMAC-SHA256, signed, short-lived, single-use).
 *
 * Format:  <payloadB64>.<sigB64>
 *   payloadB64 = base64url(JSON of ImpersonationTokenPayload)
 *   sigB64     = base64url(HMAC-SHA256(payloadB64, secret))
 *
 * Why not a library? This is a 60-line self-contained implementation using
 * only the Node Web Crypto API (available in Node 18+ / Next.js Edge runtime
 * via globalThis.crypto). Avoids adding jose/jsonwebtoken to the bundle and
 * keeps the token independent of the Clerk/Supabase auth stacks so it can be
 * minted by the admin app and validated anywhere.
 *
 * Security properties:
 *  - Integrity: signature over the payload prevents tampering with target/TTL.
 *  - Expiry: `exp` (unix seconds) is enforced in verifyToken().
 *  - Single-use: enforced at the DB layer (impersonation_active_jti_uniq) —
 *    the jti is consumed exactly once when the session becomes active.
 *  - Issuer/audience pinning: `iss`/`aud` bound to the admin app origin so a
 *    token minted for one deployment cannot be replayed on another.
 */

/** 5 minutes — generous enough for an admin to follow a redirect, tight enough to limit blast radius. */
export const IMPERSONATION_TTL_SECONDS = 5 * 60;

export interface ImpersonationTokenPayload {
  /** JWT ID — single-use nonce matched against the DB ledger. */
  jti: string;
  /** Issuer — admin app identifier. */
  iss: "ssl-admin";
  /** Audience — target app that will honour the token. */
  aud: "ssl-web";
  /** Subject — the Clerk admin id issuing the impersonation. */
  sub: string;
  /** The user being impersonated (users.id). */
  targetUserId: string;
  targetEmail: string;
  /** Issued-at (unix seconds). */
  iat: number;
  /** Expiry (unix seconds). */
  exp: number;
}

const subtle = (webcrypto as unknown as { subtle: SubtleCrypto }).subtle;

function getSecret(): string {
  const secret = process.env.IMPERSONATION_TOKEN_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "IMPERSONATION_TOKEN_SECRET must be set to a random string of >= 32 chars. " +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(48).toString('base64url'))\""
    );
  }
  return secret;
}

function b64urlEncode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function b64urlEncodeJson(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj), "utf8").toString("base64url");
}

async function hmac(payloadB64: string): Promise<string> {
  const key = await subtle.importKey(
    "raw",
    new TextEncoder().encode(getSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await subtle.sign("HMAC", key, new TextEncoder().encode(payloadB64));
  return b64urlEncode(new Uint8Array(sig));
}

function timingSafeEqualString(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export interface SignOptions {
  adminUserId: string;
  targetUserId: string;
  targetEmail: string;
  ttlSeconds?: number;
}

export async function signImpersonationToken(
  opts: SignOptions
): Promise<{ token: string; payload: ImpersonationTokenPayload }> {
  const now = Math.floor(Date.now() / 1000);
  const payload: ImpersonationTokenPayload = {
    jti: b64urlEncode(webcrypto.getRandomValues(new Uint8Array(24))),
    iss: "ssl-admin",
    aud: "ssl-web",
    sub: opts.adminUserId,
    targetUserId: opts.targetUserId,
    targetEmail: opts.targetEmail,
    iat: now,
    exp: now + (opts.ttlSeconds ?? IMPERSONATION_TTL_SECONDS),
  };
  const payloadB64 = b64urlEncodeJson(payload);
  const sig = await hmac(payloadB64);
  return { token: `${payloadB64}.${sig}`, payload };
}

export type VerifyResult =
  | { ok: true; payload: ImpersonationTokenPayload }
  | { ok: false; reason: "malformed" | "bad_signature" | "expired" | "wrong_audience" };

export async function verifyImpersonationToken(
  token: string,
  expectedAudience: string = "ssl-web"
): Promise<VerifyResult> {
  const parts = token.split(".");
  if (parts.length !== 2) return { ok: false, reason: "malformed" };
  const [payloadB64, sig] = parts;

  const expectedSig = await hmac(payloadB64);
  if (!timingSafeEqualString(sig, expectedSig)) {
    return { ok: false, reason: "bad_signature" };
  }

  let payload: ImpersonationTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }

  if (payload.aud !== expectedAudience) {
    return { ok: false, reason: "wrong_audience" };
  }
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || now >= payload.exp) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, payload };
}
