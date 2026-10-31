import { createHash, timingSafeEqual } from "node:crypto"
import type { MediaKind, MediaLimitRule } from "@mtk/database/lib/media-policy"

/**
 * ENH-07-02: the Cloudinary control-plane adapter (server only).
 *
 * Secrets never leave this module. The client receives ONE signed upload
 * endpoint+parameter set; it never chooses the folder, public id, resource
 * type or overwrite behaviour. The authorize signature has a provider-side
 * one-hour acceptance window, so a short app session does NOT revoke it - the
 * session expiry is a local refusal, not a provider guarantee.
 *
 * Finalize reads authoritative metadata from the Admin API (TLS + API key)
 * instead of trusting the client or the upload response. A missing/ambiguous
 * answer is an uncertain outcome, never "ready".
 */

export type CloudinaryConfig = {
  cloudName: string
  apiKey: string
  apiSecret: string
}

export const CLOUDINARY_SIGNATURE_WINDOW_SECONDS = 3_600
export const MEDIA_UPLOAD_SESSION_SECONDS = 900
/**
 * Originals are uploaded with the `authenticated` delivery type so a provider
 * URL can never exist before the application decides to serve the asset.
 * `upload` is still accepted on read for assets created before that change.
 */
export const MEDIA_UPLOAD_DELIVERY_TYPE = "authenticated"
export const MEDIA_PRIVATE_DELIVERY_TTL_SECONDS = 120

export function cloudinaryConfig(env: NodeJS.ProcessEnv = process.env): CloudinaryConfig | null {
  const cloudName = env.CLOUDINARY_CLOUD_NAME?.trim()
  const apiKey = env.CLOUDINARY_API_KEY?.trim()
  const apiSecret = env.CLOUDINARY_API_SECRET?.trim()
  if (!cloudName || !apiKey || !apiSecret) return null
  return { cloudName, apiKey, apiSecret }
}

// Cloudinary excludes these transport fields from the signature; `type`,
// `allowed_formats`, `max_file_size` and the public id ARE signed so a client
// cannot retarget the delivery type or widen the limits.
const UNSIGNED_PARAM_KEYS = new Set([
  "file", "api_key", "resource_type", "cloud_name", "signature",
])

/**
 * Cloudinary request signature: sort every signed parameter, join as
 * `key=value&...`, append the API secret and SHA-1 the result. The resource
 * type lives in the URL and is not signable, which is why finalize re-reads it
 * from the provider; the delivery `type` IS signed.
 */
export function signCloudinaryParams(
  params: Record<string, string | number | boolean | undefined>,
  apiSecret: string,
): string {
  if (!apiSecret) throw new Error("apiSecret is required")
  const payload = Object.entries(params)
    .filter(([key, value]) => value !== undefined && !UNSIGNED_PARAM_KEYS.has(key))
    .map(([key, value]) => [key, String(value)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join("&")
  return createHash("sha1").update(`${payload}${apiSecret}`).digest("hex")
}

function safeEqualHex(a: string, b: string): boolean {
  if (!/^[0-9a-f]+$/i.test(a) || !/^[0-9a-f]+$/i.test(b)) return false
  const left = Buffer.from(a.toLowerCase(), "hex")
  const right = Buffer.from(b.toLowerCase(), "hex")
  return left.length === right.length && timingSafeEqual(left, right)
}

/**
 * Verify the signature Cloudinary returns with an upload response. It covers
 * public id + version only - NOT format, bytes or other client metadata; those
 * must come from an authoritative read.
 */
export function verifyCloudinaryResponseSignature(input: {
  publicId: string
  version: string | number
  signature: string
  apiSecret: string
}): boolean {
  const expected = createHash("sha1")
    .update(`public_id=${input.publicId}&version=${input.version}${input.apiSecret}`)
    .digest("hex")
  return safeEqualHex(expected, input.signature)
}

export function cloudinaryResourceType(kind: MediaKind): "image" | "video" {
  if (kind === "image") return "image"
  // Cloudinary treats audio as a video resource with an audio format.
  return "video"
}

export type UploadAuthorization = {
  uploadUrl: string
  params: Record<string, string>
  expiresAt: Date
}

/** Build the ONE signed request the client is allowed to perform. */
export function buildUploadAuthorization(input: {
  config: CloudinaryConfig
  kind: MediaKind
  publicId: string
  declaredBytes: number
  allowedFormats: readonly string[]
  now?: Date
}): UploadAuthorization {
  const now = input.now ?? new Date()
  const timestamp = Math.floor(now.getTime() / 1_000)
  const params: Record<string, string> = {
    public_id: input.publicId,
    timestamp: String(timestamp),
    overwrite: "false",
    type: MEDIA_UPLOAD_DELIVERY_TYPE,
    max_file_size: String(input.declaredBytes),
    ...(input.allowedFormats.length > 0
      ? { allowed_formats: input.allowedFormats.join(",") }
      : {}),
  }
  params.signature = signCloudinaryParams(params, input.config.apiSecret)
  params.api_key = input.config.apiKey
  return {
    uploadUrl: `https://api.cloudinary.com/v1_1/${encodeURIComponent(input.config.cloudName)}/${cloudinaryResourceType(input.kind)}/upload`,
    params,
    expiresAt: new Date(now.getTime() + MEDIA_UPLOAD_SESSION_SECONDS * 1_000),
  }
}

export type ProviderAsset = {
  assetId: string | null
  publicId: string
  version: number | null
  resourceType: string
  deliveryType: string | null
  format: string | null
  bytes: number | null
  width: number | null
  height: number | null
  durationSeconds: number | null
  secureUrl: string | null
  createdAt: string | null
}

export type ProviderFetchResult =
  | { ok: true; asset: ProviderAsset }
  | { ok: false; reason: "provider_unavailable" | "provider_not_found" | "provider_invalid_response" }

type FetchLike = typeof fetch

/**
 * Authoritative Admin API read. Uses API key basic auth over TLS; the response
 * is parsed defensively and an unknown shape is refused, never guessed.
 */
export async function fetchProviderAsset(input: {
  config: CloudinaryConfig
  publicId: string
  kind: MediaKind
  fetchImpl?: FetchLike
  timeoutMs?: number
}): Promise<ProviderFetchResult> {
  const fetchImpl = input.fetchImpl ?? fetch
  const resourceType = cloudinaryResourceType(input.kind)
  let response: Response | null = null
  // Admin API reads are scoped by delivery type: look for the private
  // original first, then fall back to assets created as public.
  for (const deliveryType of [MEDIA_UPLOAD_DELIVERY_TYPE, "upload"]) {
    const url = `https://api.cloudinary.com/v1_1/${encodeURIComponent(input.config.cloudName)}/resources/${resourceType}/${deliveryType}/${encodeURIComponent(input.publicId)}`
    try {
      response = await fetchImpl(url, {
        headers: {
          Authorization: `Basic ${Buffer.from(`${input.config.apiKey}:${input.config.apiSecret}`).toString("base64")}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(input.timeoutMs ?? 8_000),
        cache: "no-store",
      })
    } catch {
      return { ok: false, reason: "provider_unavailable" }
    }
    if (response.status !== 404) break
  }
  if (!response || response.status === 404) return { ok: false, reason: "provider_not_found" }
  if (!response.ok) return { ok: false, reason: "provider_unavailable" }
  let body: unknown
  try {
    body = await response.json()
  } catch {
    return { ok: false, reason: "provider_invalid_response" }
  }
  const row = body as Record<string, unknown> | null
  if (!row || typeof row !== "object") return { ok: false, reason: "provider_invalid_response" }
  const publicId = typeof row.public_id === "string" ? row.public_id : null
  const resourceTypeValue = typeof row.resource_type === "string" ? row.resource_type : null
  if (!publicId || !resourceTypeValue) return { ok: false, reason: "provider_invalid_response" }
  return {
    ok: true,
    asset: {
      assetId: typeof row.asset_id === "string" ? row.asset_id : null,
      publicId,
      version: typeof row.version === "number" && Number.isSafeInteger(row.version) ? row.version : null,
      resourceType: resourceTypeValue,
      deliveryType: typeof row.type === "string" ? row.type : null,
      format: typeof row.format === "string" ? row.format : null,
      bytes: typeof row.bytes === "number" && Number.isSafeInteger(row.bytes) ? row.bytes : null,
      width: typeof row.width === "number" ? row.width : null,
      height: typeof row.height === "number" ? row.height : null,
      durationSeconds: typeof row.duration === "number" ? row.duration : null,
      secureUrl: typeof row.secure_url === "string" ? row.secure_url : null,
      createdAt: typeof row.created_at === "string" ? row.created_at : null,
    },
  }
}

const FORMAT_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  m4v: "video/x-m4v",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
}

export function mimeTypeForFormat(format: string | null | undefined): string | null {
  if (!format) return null
  return FORMAT_MIME[format.trim().toLowerCase()] ?? null
}

export type ProviderAssetValidation =
  | {
      ok: true
      bytes: number
      mimeType: string
      format: string
      width: number | null
      height: number | null
      durationSeconds: number | null
    }
  | {
      ok: false
      reason:
        | "public_id_mismatch"
        | "resource_type_mismatch"
        | "untrusted_delivery_type"
        | "unknown_format"
        | "format_not_allowed"
        | "mime_mismatch"
        | "bytes_unverifiable"
        | "bytes_exceed_declared"
        | "bytes_exceed_limit"
        | "duration_unverifiable"
        | "duration_exceeds_limit"
    }

/**
 * The finalize gate. A client declaration is only a ceiling: the authoritative
 * bytes/format/duration must exist and fit BOTH the declaration and the
 * deployment limit. Anything unverifiable is a quarantine reason, never ready.
 */
export function validateProviderAsset(input: {
  asset: ProviderAsset
  expectedPublicId: string
  kind: MediaKind
  declaredMimeType: string
  declaredBytes: number
  rule: MediaLimitRule
}): ProviderAssetValidation {
  const { asset, rule } = input
  if (asset.publicId !== input.expectedPublicId) return { ok: false, reason: "public_id_mismatch" }
  if (asset.resourceType !== cloudinaryResourceType(input.kind)) {
    return { ok: false, reason: "resource_type_mismatch" }
  }
  if (asset.deliveryType !== MEDIA_UPLOAD_DELIVERY_TYPE && asset.deliveryType !== "upload") {
    return { ok: false, reason: "untrusted_delivery_type" }
  }

  const format = asset.format?.trim().toLowerCase() ?? null
  const mimeType = mimeTypeForFormat(format)
  if (!format || !mimeType) return { ok: false, reason: "unknown_format" }
  if (!rule.allowedMimeTypes.includes(mimeType)) return { ok: false, reason: "format_not_allowed" }
  // The authoritative format must be the one that was declared and signed.
  // An allowed-but-different format is still a forged declaration.
  if (mimeType !== input.declaredMimeType.trim().toLowerCase()) {
    return { ok: false, reason: "mime_mismatch" }
  }
  if (asset.bytes == null || asset.bytes <= 0) return { ok: false, reason: "bytes_unverifiable" }
  if (asset.bytes > input.declaredBytes) return { ok: false, reason: "bytes_exceed_declared" }
  if (asset.bytes > rule.maxBytes) return { ok: false, reason: "bytes_exceed_limit" }

  if (input.kind !== "image" && rule.maxDurationSeconds != null) {
    if (asset.durationSeconds == null || asset.durationSeconds <= 0) {
      return { ok: false, reason: "duration_unverifiable" }
    }
    if (asset.durationSeconds > rule.maxDurationSeconds) {
      return { ok: false, reason: "duration_exceeds_limit" }
    }
  }

  return {
    ok: true,
    bytes: asset.bytes,
    mimeType,
    format,
    width: asset.width,
    height: asset.height,
    durationSeconds: asset.durationSeconds,
  }
}

/**
 * Time-limited, signed download URL for an `authenticated` original (the
 * Cloudinary `private_download_url` contract). It is minted per request for an
 * asset the application has already decided to serve, and expires within
 * minutes, so unpublishing takes effect without chasing leaked URLs.
 */
export function privateDeliveryUrl(input: {
  config: CloudinaryConfig
  kind: MediaKind
  format: string
  publicId: string
  now?: Date
  ttlSeconds?: number
}): string {
  const now = input.now ?? new Date()
  const timestamp = Math.floor(now.getTime() / 1_000)
  const params: Record<string, string> = {
    attachment: "false",
    expires_at: String(timestamp + (input.ttlSeconds ?? MEDIA_PRIVATE_DELIVERY_TTL_SECONDS)),
    format: input.format,
    public_id: input.publicId,
    timestamp: String(timestamp),
    type: MEDIA_UPLOAD_DELIVERY_TYPE,
  }
  const signature = signCloudinaryParams(params, input.config.apiSecret)
  const query = new URLSearchParams({ ...params, api_key: input.config.apiKey, signature })
  return `https://api.cloudinary.com/v1_1/${encodeURIComponent(input.config.cloudName)}/${cloudinaryResourceType(input.kind)}/download?${query.toString()}`
}

/**
 * Public delivery URL is built from verified provider identity, never from a
 * client-supplied URL. Only legacy `upload`-type assets use this.
 */
export function publicDeliveryUrl(input: {
  config: CloudinaryConfig
  kind: MediaKind
  format: string | null
  publicId: string
  version: number | null
}): string {
  const resourceType = cloudinaryResourceType(input.kind)
  const version = input.version != null ? `v${input.version}/` : ""
  const format = input.format ? `.${input.format}` : ""
  return `https://res.cloudinary.com/${encodeURIComponent(input.config.cloudName)}/${resourceType}/upload/${version}${input.publicId}${format}`
}
