/**
 * ENH-07-01: media policy, shared by web/admin/services.
 *
 * The portable vocabulary and the upload/publication/binding/cleanup decisions
 * are single-sourced from `@mtk/contracts/media` so the SQL checks, API
 * routes and any native reader cannot drift. This module adds the
 * database/worker-side rules that need no I/O: quota reservation arithmetic,
 * upload-session expiry and the bounded cleanup retry ladder.
 *
 * Nothing here invents provider quotas. A deployment that has no approved
 * byte limit reads `quota_unconfigured` and refuses the reservation.
 */
export {
  MEDIA_CONTRACT_VERSION,
  MEDIA_KIND_VALUES,
  MEDIA_ASSET_STATE_VALUES,
  MEDIA_PUBLICATION_VALUES,
  MEDIA_CONSENT_VALUES,
  MEDIA_BINDING_TYPE_VALUES,
  MEDIA_ROLE_VALUES,
  MEDIA_UPLOAD_STATE_VALUES,
  MEDIA_CLEANUP_STATE_VALUES,
  mediaAssetIdSchema,
  mediaBindingSchema,
  authorizeMediaUploadRequestSchema,
  mediaUploadLimitDecision,
  mediaBindingDecision,
  mediaPublicationDecision,
  mediaDeliveryDecision,
  classifyLegacyMedia,
  mediaCleanupDecision,
  mediaCleanupIsTerminal,
  type MediaKind,
  type MediaAssetState,
  type MediaPublication,
  type MediaConsentState,
  type MediaBindingType,
  type MediaRole,
  type MediaUploadState,
  type MediaCleanupState,
  type MediaBinding,
  type AuthorizeMediaUploadRequest,
  type MediaLimitRule,
  type MediaLimits,
  type MediaLimitDecision,
  type MediaBindingDecision,
  type MediaPublicationDecision,
  type MediaDeliveryAudience,
  type MediaCleanupDecision,
} from "@mtk/contracts"

export const MEDIA_CLEANUP_MAX_ATTEMPTS = 8

/** Same bounded ladder as the other durable queues (5s .. 1h). */
const CLEANUP_BACKOFF_SECONDS = [5, 30, 120, 600, 1_800, 3_600] as const

export function mediaCleanupRetryDelayMs(attempt: number): number {
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new Error("attempt must be a positive integer")
  }
  const index = Math.min(attempt - 1, CLEANUP_BACKOFF_SECONDS.length - 1)
  return CLEANUP_BACKOFF_SECONDS[index] * 1_000
}

export type MediaQuotaDecision =
  | { allowed: true; reservedAfter: number }
  | {
      allowed: false
      reason: "quota_unconfigured" | "invalid_request" | "quota_exceeded"
      availableBytes: number
    }

/**
 * Atomic-reservation arithmetic (the caller locks the quota row in the same
 * transaction). `reserved` counts live upload sessions; `used` counts verified
 * assets. Both are included so an in-flight upload cannot exceed the ceiling.
 */
export function mediaQuotaDecision(input: {
  limitBytes: number | null | undefined
  usedBytes: number
  reservedBytes: number
  requestedBytes: number
}): MediaQuotaDecision {
  if (input.limitBytes == null || !Number.isSafeInteger(input.limitBytes) || input.limitBytes <= 0) {
    return { allowed: false, reason: "quota_unconfigured", availableBytes: 0 }
  }
  const values = [input.usedBytes, input.reservedBytes, input.requestedBytes]
  if (values.some(value => !Number.isSafeInteger(value) || value < 0)) {
    return { allowed: false, reason: "invalid_request", availableBytes: 0 }
  }
  const availableBytes = Math.max(0, input.limitBytes - input.usedBytes - input.reservedBytes)
  if (input.requestedBytes === 0 || input.requestedBytes > availableBytes) {
    return { allowed: false, reason: "quota_exceeded", availableBytes }
  }
  return { allowed: true, reservedAfter: input.reservedBytes + input.requestedBytes }
}

export function mediaUploadSessionExpired(input: { expiresAt: Date; now: Date }): boolean {
  return input.expiresAt.getTime() <= input.now.getTime()
}

/**
 * Webhook freshness. Provider notifications are rejected when their signed
 * timestamp is outside a small window; a replayed body cannot be accepted
 * forever just because its HMAC is valid. The window is deployment policy, not
 * a provider guarantee.
 */
export const MEDIA_WEBHOOK_FRESHNESS_SECONDS = 300
export const MEDIA_WEBHOOK_MAX_FUTURE_SKEW_SECONDS = 60

export function mediaWebhookTimestampAcceptable(input: {
  timestampSeconds: number
  nowSeconds: number
  freshnessSeconds?: number
  futureSkewSeconds?: number
}): boolean {
  if (!Number.isFinite(input.timestampSeconds) || !Number.isFinite(input.nowSeconds)) return false
  const freshness = input.freshnessSeconds ?? MEDIA_WEBHOOK_FRESHNESS_SECONDS
  const futureSkew = input.futureSkewSeconds ?? MEDIA_WEBHOOK_MAX_FUTURE_SKEW_SECONDS
  const age = input.nowSeconds - input.timestampSeconds
  return age <= freshness && age >= -futureSkew
}

/**
 * Dedup identity for a provider webhook. The provider event id is required;
 * when a provider only supplies a content hash, that hash is the id - never a
 * timestamp (two real events can share a second).
 */
export function mediaWebhookDedupKey(input: {
  provider: string
  eventId: string
}): string {
  const provider = input.provider.trim().toLowerCase()
  const eventId = input.eventId.trim()
  if (!provider || !eventId) throw new Error("provider and eventId are required")
  return `media-webhook:${provider}:${eventId}`.slice(0, 240)
}
