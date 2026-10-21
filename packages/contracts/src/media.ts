/**
 * ENH-07-01: the media vocabulary, portable to every surface.
 *
 * This is the WIRE CONTRACT for upload lifecycle, publication, consent,
 * resource binding and cleanup. It deliberately contains NO provider secret,
 * no signing code and no database access: the Cloudinary control plane stays
 * server-side. Pure TypeScript + zod only, so Expo/React Native can consume the
 * enums without pulling a browser/node dependency.
 *
 * The hardest rule is encoded here rather than in prose: an existing URL is
 * NEVER evidence of a verified asset. Rows that predate this contract are
 * `legacy_unverified` and `unpublished` until an authoritative re-check says
 * otherwise.
 */
import { z } from "zod"

export const MEDIA_CONTRACT_VERSION = 1 as const

export const MEDIA_KIND_VALUES = ["image", "video", "audio"] as const
export type MediaKind = (typeof MEDIA_KIND_VALUES)[number]

/**
 * `legacy_unverified` is NOT a temporary typo: it names every pre-contract
 * asset whose provider identity, content or consent has never been verified.
 * Only an explicit server re-check may move a row out of it.
 */
export const MEDIA_ASSET_STATE_VALUES = [
  "legacy_unverified",
  "pending",
  "processing",
  "ready",
  "quarantined",
  "failed",
  "deleted",
] as const
export type MediaAssetState = (typeof MEDIA_ASSET_STATE_VALUES)[number]

/**
 * Publication is separate from readiness: a `ready` asset is still private
 * until an authorized publisher publishes it. `withdrawn` is a deliberate
 * retraction, not a deletion.
 */
export const MEDIA_PUBLICATION_VALUES = ["unpublished", "published", "withdrawn"] as const
export type MediaPublication = (typeof MEDIA_PUBLICATION_VALUES)[number]

/**
 * Consent is tracked per asset/purpose. A video of a minor or a player photo is
 * never publishable on readiness alone.
 */
export const MEDIA_CONSENT_VALUES = ["not_required", "pending", "granted", "withdrawn"] as const
export type MediaConsentState = (typeof MEDIA_CONSENT_VALUES)[number]

export const MEDIA_BINDING_TYPE_VALUES = [
  "tournament",
  "venue",
  "branding",
  "team",
  "player",
  "match",
] as const
export type MediaBindingType = (typeof MEDIA_BINDING_TYPE_VALUES)[number]

export const MEDIA_ROLE_VALUES = [
  "logo",
  "banner",
  "gallery",
  "highlight",
  "thumbnail",
  "avatar",
] as const
export type MediaRole = (typeof MEDIA_ROLE_VALUES)[number]

export const MEDIA_UPLOAD_STATE_VALUES = ["reserved", "finalized", "expired", "cancelled"] as const
export type MediaUploadState = (typeof MEDIA_UPLOAD_STATE_VALUES)[number]

export const MEDIA_CLEANUP_STATE_VALUES = [
  "pending",
  "leased",
  "provider_destroyed",
  "failed",
  "dead_lettered",
] as const
export type MediaCleanupState = (typeof MEDIA_CLEANUP_STATE_VALUES)[number]

export const mediaAssetIdSchema = z.string().uuid()
export const mediaBindingSchema = z.object({
  type: z.enum(MEDIA_BINDING_TYPE_VALUES),
  resourceId: z.string().uuid(),
}).strict()
export type MediaBinding = z.infer<typeof mediaBindingSchema>

/**
 * The client declares its intent; the SERVER never trusts these values as
 * authoritative metadata. They exist to refuse obviously unacceptable uploads
 * before a signed request is issued.
 */
export const authorizeMediaUploadRequestSchema = z.object({
  kind: z.enum(MEDIA_KIND_VALUES),
  mimeType: z.string().min(3).max(120),
  bytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  durationSeconds: z.number().int().positive().max(86_400).optional(),
}).strict()
export type AuthorizeMediaUploadRequest = z.infer<typeof authorizeMediaUploadRequestSchema>

/**
 * Limits are supplied by deployment configuration, never invented by this
 * package: the roadmap explicitly has no approved provider quotas yet. A
 * missing or empty rule is `limits_unconfigured`, which refuses the upload.
 */
export type MediaLimitRule = {
  maxBytes: number
  allowedMimeTypes: readonly string[]
  maxDurationSeconds?: number
}
export type MediaLimits = {
  image?: MediaLimitRule
  video?: MediaLimitRule
  audio?: MediaLimitRule
}

export type MediaLimitDecision =
  | { allowed: true }
  | {
      allowed: false
      reason:
        | "limits_unconfigured"
        | "kind_not_allowed"
        | "mime_not_allowed"
        | "too_large"
        | "duration_unbounded"
        | "duration_too_long"
    }

/**
 * Refuse before signing. A declaration that cannot be checked is refused - it
 * is never treated as if it were within limits.
 */
export function mediaUploadLimitDecision(
  request: Pick<AuthorizeMediaUploadRequest, "kind" | "mimeType" | "bytes" | "durationSeconds">,
  limits: MediaLimits | null | undefined,
): MediaLimitDecision {
  const rule = limits?.[request.kind]
  if (!rule || rule.maxBytes <= 0 || rule.allowedMimeTypes.length === 0) {
    return { allowed: false, reason: "limits_unconfigured" }
  }
  if (!rule.allowedMimeTypes.includes(request.mimeType.toLowerCase())) {
    return { allowed: false, reason: "mime_not_allowed" }
  }
  if (!Number.isSafeInteger(request.bytes) || request.bytes <= 0 || request.bytes > rule.maxBytes) {
    return { allowed: false, reason: "too_large" }
  }
  if (request.kind !== "image" && rule.maxDurationSeconds != null) {
    if (request.durationSeconds == null) return { allowed: false, reason: "duration_unbounded" }
    if (request.durationSeconds > rule.maxDurationSeconds) {
      return { allowed: false, reason: "duration_too_long" }
    }
  }
  return { allowed: true }
}

export type MediaBindingDecision =
  | { allowed: true }
  | {
      allowed: false
      reason: "foreign_tenant" | "asset_not_ready" | "asset_quarantined" | "resource_tenant_mismatch"
    }

/**
 * A binding can only connect an asset, a resource and a request inside ONE
 * tenant. A missing tenant is not a wildcard.
 */
export function mediaBindingDecision(input: {
  requestTenantId: string
  assetTenantId: string | null
  resourceTenantId: string | null
  assetState: MediaAssetState
}): MediaBindingDecision {
  if (!input.assetTenantId || input.assetTenantId !== input.requestTenantId) {
    return { allowed: false, reason: "foreign_tenant" }
  }
  if (!input.resourceTenantId || input.resourceTenantId !== input.requestTenantId) {
    return { allowed: false, reason: "resource_tenant_mismatch" }
  }
  if (input.assetState === "quarantined") {
    return { allowed: false, reason: "asset_quarantined" }
  }
  if (input.assetState !== "ready") {
    return { allowed: false, reason: "asset_not_ready" }
  }
  return { allowed: true }
}

export type MediaPublicationDecision =
  | { allowed: true }
  | {
      allowed: false
      reason:
        | "asset_not_ready"
        | "asset_quarantined"
        | "consent_pending"
        | "consent_withdrawn"
        | "already_withdrawn"
    }

/** Publish only a ready asset whose consent is settled. */
export function mediaPublicationDecision(input: {
  state: MediaAssetState
  consent: MediaConsentState
  publication: MediaPublication
}): MediaPublicationDecision {
  if (input.state === "quarantined") return { allowed: false, reason: "asset_quarantined" }
  if (input.state !== "ready") return { allowed: false, reason: "asset_not_ready" }
  if (input.consent === "pending") return { allowed: false, reason: "consent_pending" }
  if (input.consent === "withdrawn") return { allowed: false, reason: "consent_withdrawn" }
  if (input.publication === "withdrawn") return { allowed: false, reason: "already_withdrawn" }
  return { allowed: true }
}

export type MediaDeliveryAudience = "public" | "member" | "operator"

/**
 * The public/member delivery gate. Nothing about a stored URL, a provider
 * version or an old publication flag can open an unverified or non-ready
 * asset. Operators may inspect lifecycle state, but a quarantined asset is
 * never delivered as content.
 */
export function mediaDeliveryDecision(input: {
  state: MediaAssetState
  publication: MediaPublication
  audience: MediaDeliveryAudience
}): { allowed: boolean } {
  if (input.audience === "operator") {
    return { allowed: input.state !== "deleted" }
  }
  return { allowed: input.state === "ready" && input.publication === "published" }
}

/**
 * Existing rows/URLs are classified honestly. This function intentionally
 * takes no URL and returns no approval: a URL is a locator, not evidence of
 * provider identity, content safety or consent.
 */
export function classifyLegacyMedia(): {
  state: Extract<MediaAssetState, "legacy_unverified">
  publication: Extract<MediaPublication, "unpublished">
  needsAuthoritativeRecheck: true
} {
  return { state: "legacy_unverified", publication: "unpublished", needsAuthoritativeRecheck: true }
}

export type MediaCleanupDecision =
  | { required: false }
  | {
      required: true
      actions: Array<"destroy_provider_asset" | "invalidate_delivery">
      /** Cleanup must keep the asset identity so the provider can be found again. */
      preserveProviderIdentity: true
    }

/**
 * A delete/quarantine/consent-withdrawal must queue provider destruction and
 * delivery invalidation, but never erase the provider identity before the
 * destruction is confirmed. A tombstone is a record, not a removal.
 */
export function mediaCleanupDecision(input: {
  beforeState: MediaAssetState
  afterState: MediaAssetState
  consent: MediaConsentState
}): MediaCleanupDecision {
  const wasLive = input.beforeState === "ready" || input.beforeState === "processing"
  const nowGone = input.afterState === "deleted" || input.afterState === "quarantined"
  const consentWithdrawn = input.consent === "withdrawn" && input.beforeState !== "deleted"
  if (!(wasLive && nowGone) && !consentWithdrawn) return { required: false }
  return {
    required: true,
    actions: ["destroy_provider_asset", "invalidate_delivery"],
    preserveProviderIdentity: true,
  }
}

/** Cleanup retry ladder state; terminal only at the cap or after provider confirmation. */
export function mediaCleanupIsTerminal(input: {
  state: MediaCleanupState
  attempts: number
  maxAttempts: number
}): boolean {
  if (input.state === "provider_destroyed") return true
  if (input.state === "dead_lettered") return true
  return input.attempts >= input.maxAttempts && input.state !== "leased"
}
