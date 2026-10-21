/**
 * ENH-07-01: web import point for the media policy.
 *
 * The decisions themselves are single-sourced from the database layer
 * (`@mtk/database/lib/media-policy`, which re-exports the portable contract),
 * so an API route, a worker and a native reader cannot disagree about whether
 * an asset is deliverable. This module exists so web callers have one stable
 * import and so deployment-only concerns (limits) are explicit.
 *
 * No approved provider quota exists yet (roadmap blocked register). A
 * deployment must supply limits; an unconfigured limit REFUSES the upload.
 */
export {
  MEDIA_KIND_VALUES,
  MEDIA_ASSET_STATE_VALUES,
  MEDIA_PUBLICATION_VALUES,
  MEDIA_CONSENT_VALUES,
  MEDIA_BINDING_TYPE_VALUES,
  MEDIA_ROLE_VALUES,
  MEDIA_CLEANUP_STATE_VALUES,
  MEDIA_CLEANUP_MAX_ATTEMPTS,
  authorizeMediaUploadRequestSchema,
  mediaUploadLimitDecision,
  mediaBindingDecision,
  mediaPublicationDecision,
  mediaDeliveryDecision,
  classifyLegacyMedia,
  mediaCleanupDecision,
  mediaCleanupRetryDelayMs,
  mediaQuotaDecision,
  mediaUploadSessionExpired,
  mediaWebhookTimestampAcceptable,
  mediaWebhookDedupKey,
  type MediaKind,
  type MediaAssetState,
  type MediaPublication,
  type MediaConsentState,
  type MediaBindingType,
  type MediaRole,
  type MediaLimits,
  type MediaLimitRule,
  type AuthorizeMediaUploadRequest,
} from "@mtk/database/lib/media-policy"

import type { MediaLimitRule, MediaLimits } from "@mtk/database/lib/media-policy"

/**
 * Read limits from explicit deployment settings. Partial/invalid settings
 * return `null` for that kind, which the policy reports as unconfigured -
 * never as unlimited.
 */
export type MediaLimitSettings = {
  image?: { maxBytes?: number | string | null; allowedMimeTypes?: string | null }
  video?: { maxBytes?: number | string | null; allowedMimeTypes?: string | null; maxDurationSeconds?: number | string | null }
  audio?: { maxBytes?: number | string | null; allowedMimeTypes?: string | null; maxDurationSeconds?: number | string | null }
}

function positiveInt(value: number | string | null | undefined): number | null {
  if (value == null) return null
  const parsed = typeof value === "number" ? value : Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null
}

function mimeList(value: string | null | undefined): string[] {
  if (!value) return []
  return value.split(",").map(entry => entry.trim().toLowerCase()).filter(Boolean)
}

function rule(settings: {
  maxBytes?: number | string | null
  allowedMimeTypes?: string | null
  maxDurationSeconds?: number | string | null
} | undefined, withDuration: boolean): MediaLimitRule | undefined {
  if (!settings) return undefined
  const maxBytes = positiveInt(settings.maxBytes)
  const allowedMimeTypes = mimeList(settings.allowedMimeTypes)
  if (maxBytes == null || allowedMimeTypes.length === 0) return undefined
  const maxDurationSeconds = withDuration ? positiveInt(settings.maxDurationSeconds) : undefined
  return {
    maxBytes,
    allowedMimeTypes,
    ...(maxDurationSeconds != null ? { maxDurationSeconds } : {}),
  }
}

export function buildMediaLimits(settings: MediaLimitSettings): MediaLimits {
  const image = rule(settings.image, false)
  const video = rule(settings.video, true)
  const audio = rule(settings.audio, true)
  return {
    ...(image ? { image } : {}),
    ...(video ? { video } : {}),
    ...(audio ? { audio } : {}),
  }
}

/**
 * Deployment limits are read from explicit `MEDIA_*` settings. There is no
 * default: an operator who has not approved a provider quota gets an empty
 * limit set and every upload is refused as `limits_unconfigured`.
 */
export function mediaLimitsFromEnv(env: NodeJS.ProcessEnv = process.env): MediaLimits {
  return buildMediaLimits({
    image: {
      maxBytes: env.MEDIA_IMAGE_MAX_BYTES,
      allowedMimeTypes: env.MEDIA_IMAGE_MIME_TYPES,
    },
    video: {
      maxBytes: env.MEDIA_VIDEO_MAX_BYTES,
      allowedMimeTypes: env.MEDIA_VIDEO_MIME_TYPES,
      maxDurationSeconds: env.MEDIA_VIDEO_MAX_DURATION_SECONDS,
    },
    audio: {
      maxBytes: env.MEDIA_AUDIO_MAX_BYTES,
      allowedMimeTypes: env.MEDIA_AUDIO_MIME_TYPES,
      maxDurationSeconds: env.MEDIA_AUDIO_MAX_DURATION_SECONDS,
    },
  })
}
