import { createHmac, timingSafeEqual } from "node:crypto"
import { z } from "zod"

/**
 * ENH-09-01: revocable read-only overlay capability.
 *
 * The OBS browser source has no Clerk session. A short-lived HMAC token binds
 * one match + tenant to a read-only overlay. Rotating
 * `BROADCAST_OVERLAY_SECRET` revokes every existing overlay; expiry bounds a
 * leaked URL. The token is not accepted by any mutation route.
 */

const payloadSchema = z.object({
  v: z.literal(1),
  tenantId: z.string().uuid(),
  matchId: z.string().uuid(),
  iat: z.number().int().nonnegative(),
  exp: z.number().int().positive(),
}).strict()

export type BroadcastOverlayTokenPayload = z.infer<typeof payloadSchema>

const MIN_SECRET_LENGTH = 32
const MAX_TTL_SECONDS = 12 * 60 * 60
const MIN_TTL_SECONDS = 60

export function broadcastOverlaySecret(env = process.env): string {
  const secret = env.BROADCAST_OVERLAY_SECRET?.trim()
  if (!secret || secret.length < MIN_SECRET_LENGTH) {
    throw new Error("BROADCAST_OVERLAY_SECRET is not configured")
  }
  return secret
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url")
}

function signature(payloadPart: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(`v1.${payloadPart}`).digest()
}

export function signBroadcastOverlayToken(input: {
  tenantId: string
  matchId: string
  ttlSeconds?: number
  now?: Date
}, secret: string): string {
  if (secret.length < MIN_SECRET_LENGTH) throw new Error("Overlay secret is too short")
  const now = input.now ?? new Date()
  const ttl = input.ttlSeconds ?? 4 * 60 * 60
  if (!Number.isInteger(ttl) || ttl < MIN_TTL_SECONDS || ttl > MAX_TTL_SECONDS) {
    throw new Error("Overlay token TTL is outside the allowed range")
  }
  const payload = payloadSchema.parse({
    v: 1,
    tenantId: input.tenantId,
    matchId: input.matchId,
    iat: Math.floor(now.getTime() / 1_000),
    exp: Math.floor(now.getTime() / 1_000) + ttl,
  })
  const payloadPart = base64url(JSON.stringify(payload))
  return `v1.${payloadPart}.${base64url(signature(payloadPart, secret))}`
}

export function verifyBroadcastOverlayToken(
  token: string,
  secret: string,
  now: Date = new Date(),
): BroadcastOverlayTokenPayload | null {
  if (secret.length < MIN_SECRET_LENGTH) return null
  if (!token || token.length > 4_096) return null
  const parts = token.split(".")
  if (parts.length !== 3 || parts[0] !== "v1") return null
  const [, payloadPart, signaturePart] = parts
  if (!payloadPart || !signaturePart) return null

  let provided: Buffer
  try {
    provided = Buffer.from(signaturePart, "base64url")
  } catch {
    return null
  }
  const expected = signature(payloadPart, secret)
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null

  let payload: BroadcastOverlayTokenPayload
  try {
    payload = payloadSchema.parse(JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8")))
  } catch {
    return null
  }

  const nowSeconds = Math.floor(now.getTime() / 1_000)
  if (payload.exp <= nowSeconds) return null
  if (payload.iat > nowSeconds + 300) return null
  if (payload.exp - payload.iat > MAX_TTL_SECONDS) return null
  return payload
}
