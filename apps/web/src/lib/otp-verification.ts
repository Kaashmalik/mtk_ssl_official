import { db, verificationTokens } from "@mtk/database"
import { and, desc, eq, gt, gte, isNull } from "drizzle-orm"
import { dispatchOtp, generateOtpCode, hashOtp, OTP_MAX_PER_HOUR, OTP_RESEND_COOLDOWN_MS, OTP_TTL_MS, verifyOtpHash } from "@/lib/otp"

/**
 * OTP issue/verify database flows (the HTTP routes only parse input and map
 * results). Verification claims the wrong-attempt increment with the cap in
 * the UPDATE predicate, so concurrent wrong guesses cannot race past
 * `maxAttempts` — every increment either lands under the cap or is refused.
 */

export type OtpPurpose = "registration" | "password_reset" | "renewal_confirm" | "super_admin_2fa"
export type OtpChannel = "whatsapp" | "sms" | "email"

export type SendOtpResult =
  | { ok: true; mock: boolean }
  | { ok: false; reason: "rate_limited" | "cooldown" }

export async function sendOtp(input: {
  identifier: string
  channel: OtpChannel
  purpose: OtpPurpose
}): Promise<SendOtpResult> {
  const { identifier, channel, purpose } = input

  // Rate limit: max requests in the last hour per identifier+purpose.
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
  const recent = await db.select().from(verificationTokens).where(
    and(
      eq(verificationTokens.identifier, identifier),
      eq(verificationTokens.purpose, purpose),
      gte(verificationTokens.createdAt, oneHourAgo),
    ),
  )
  if (recent.length >= OTP_MAX_PER_HOUR) {
    return { ok: false, reason: "rate_limited" }
  }

  // Cooldown: the last request must be older than the resend window.
  const last = recent.sort((a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime())[0]
  if (last && Date.now() - (last.createdAt as Date).getTime() < OTP_RESEND_COOLDOWN_MS) {
    return { ok: false, reason: "cooldown" }
  }

  const code = generateOtpCode()
  await db.insert(verificationTokens).values({
    identifier,
    tokenHash: hashOtp(identifier, code),
    channel,
    purpose,
    expiresAt: new Date(Date.now() + OTP_TTL_MS),
  })

  const { mock } = await dispatchOtp(channel, identifier, code)
  return { ok: true, mock }
}

export type VerifyOtpResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "exhausted" | "wrong"; remaining?: number }

export async function verifyLatestOtp(input: {
  identifier: string
  purpose: OtpPurpose
  code: string
}): Promise<VerifyOtpResult> {
  const { identifier, purpose, code } = input

  const [token] = await db.select().from(verificationTokens).where(
    and(
      eq(verificationTokens.identifier, identifier),
      eq(verificationTokens.purpose, purpose),
      isNull(verificationTokens.verifiedAt),
      gt(verificationTokens.expiresAt, new Date()),
    ),
  ).orderBy(desc(verificationTokens.createdAt)).limit(1)

  if (!token) return { ok: false, reason: "not_found" }

  // Fast path: an already-exhausted token is refused without a hash attempt.
  if (token.attempts >= token.maxAttempts) {
    return { ok: false, reason: "exhausted" }
  }

  if (verifyOtpHash(identifier, code, token.tokenHash)) {
    await db.update(verificationTokens)
      .set({ verifiedAt: new Date() })
      .where(eq(verificationTokens.id, token.id))
    return { ok: true }
  }

  // Predicated wrong-attempt increment: the cap lives inside the UPDATE, so
  // concurrent wrong guesses can never push `attempts` past `maxAttempts`.
  const [claimed] = await db.update(verificationTokens)
    .set({ attempts: token.attempts + 1 })
    .where(and(
      eq(verificationTokens.id, token.id),
      gt(verificationTokens.maxAttempts, token.attempts),
      eq(verificationTokens.attempts, token.attempts),
    ))
    .returning({ attempts: verificationTokens.attempts })

  if (!claimed) return { ok: false, reason: "exhausted" }
  return { ok: false, reason: "wrong", remaining: token.maxAttempts - claimed.attempts }
}
