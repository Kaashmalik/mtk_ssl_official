import { createHash, timingSafeEqual } from "node:crypto"
import { and, eq } from "drizzle-orm"
import { z } from "zod"
import { db, mediaAssets, mediaProcessingEvents } from "@mtk/database"
import { cloudinaryConfig } from "./media-provider"
import {
  mediaWebhookDedupKey,
  mediaWebhookTimestampAcceptable,
} from "./media-policy"
import { enqueueMediaCleanupJobs } from "./media-cleanup"

/**
 * ENH-07-03: verified Cloudinary webhook intake.
 *
 * Cloudinary signs `rawBody + X-Cld-Timestamp` with the API secret as a plain
 * SHA-1/SHA-256 suffix digest (not a keyed HMAC). We verify the RAW bytes
 * before parsing, enforce a freshness window, and dedup on a hash of the raw
 * body - never on a timestamp, because two real events can share a second.
 *
 * A valid but unknown/malformed payload is QUARANTINED and acknowledged (200)
 * so the provider stops retrying poison. A bad signature is 401. The webhook
 * can never create a new asset: only server finalize does that. An upload
 * notification that disagrees with the finalized provider version/metadata
 * quarantines the asset and queues provider destruction.
 */

const notificationSchema = z.object({
  notification_type: z.string().min(1).max(64).optional(),
  public_id: z.string().min(1).max(300).optional(),
  public_ids: z.array(z.string().min(1).max(300)).max(100).optional(),
  resource_type: z.string().min(1).max(32).optional(),
  type: z.string().min(1).max(32).optional(),
  bytes: z.number().int().nonnegative().optional(),
  format: z.string().min(1).max(32).optional(),
  version: z.number().int().nonnegative().optional(),
  etag: z.string().max(128).optional(),
  created_at: z.string().max(64).optional(),
}).passthrough()

type Notification = z.infer<typeof notificationSchema>

export type MediaWebhookResponse = {
  httpStatus: number
  body: { status: string; reason?: string }
}

export function verifyCloudinaryWebhookSignature(input: {
  rawBody: string
  timestamp: string
  signature: string
  apiSecret: string
  algorithm?: "sha1" | "sha256"
}): boolean {
  const algorithm = input.algorithm
    ?? (process.env.CLOUDINARY_SIGNATURE_ALGORITHM === "sha256" ? "sha256" : "sha1")
  const expected = createHash(algorithm)
    .update(`${input.rawBody}${input.timestamp}${input.apiSecret}`)
    .digest("hex")
  const provided = input.signature.trim().toLowerCase()
  if (!/^[0-9a-f]+$/.test(provided) || provided.length !== expected.length) return false
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(provided, "hex"))
}

export async function receiveCloudinaryWebhook(input: {
  rawBody: string
  timestamp: string | null
  signature: string | null
  now?: Date
}): Promise<MediaWebhookResponse> {
  const config = cloudinaryConfig()
  if (!config) return { httpStatus: 503, body: { status: "provider_unconfigured" } }
  if (!input.timestamp || !input.signature) {
    return { httpStatus: 401, body: { status: "unauthorized" } }
  }
  const timestampSeconds = Number(input.timestamp)
  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1_000)
  // Cloudinary retries at 3/6/9 minutes and its own SDKs default to a 2-hour
  // window; use the provider-compatible bound while dedup prevents replays.
  if (!mediaWebhookTimestampAcceptable({
    timestampSeconds,
    nowSeconds,
    freshnessSeconds: 7_200,
  })) {
    return { httpStatus: 401, body: { status: "stale" } }
  }
  if (!verifyCloudinaryWebhookSignature({
    rawBody: input.rawBody,
    timestamp: input.timestamp,
    signature: input.signature,
    apiSecret: config.apiSecret,
  })) {
    return { httpStatus: 401, body: { status: "unauthorized" } }
  }

  let parsedJson: unknown
  try {
    parsedJson = JSON.parse(input.rawBody)
  } catch {
    await quarantineRawPayload(input.rawBody, "invalid_json", input.now)
    return { httpStatus: 200, body: { status: "quarantined", reason: "invalid_json" } }
  }
  const parsed = notificationSchema.safeParse(parsedJson)
  if (!parsed.success) {
    await quarantineRawPayload(input.rawBody, "invalid_payload", input.now)
    return { httpStatus: 200, body: { status: "quarantined", reason: "invalid_payload" } }
  }

  const result = await processNotification(parsed.data, input.rawBody, input.now ?? new Date())
  if (result.status === "applied") {
    return { httpStatus: 200, body: { status: "applied" } }
  }
  if (result.status === "duplicate") {
    return { httpStatus: 200, body: { status: "duplicate" } }
  }
  return { httpStatus: 200, body: { status: "quarantined", reason: result.reason } }
}

type ProcessOutcome =
  | { status: "applied" }
  | { status: "duplicate" }
  | { status: "quarantined"; reason: string }

function payloadHash(rawBody: string): string {
  return createHash("sha256").update(rawBody).digest("hex")
}

async function quarantineRawPayload(rawBody: string, reason: string, now = new Date()): Promise<void> {
  const hash = payloadHash(rawBody)
  await db.insert(mediaProcessingEvents)
    .values({
      tenantId: null,
      assetId: null,
      provider: "cloudinary",
      providerEventId: hash,
      dedupKey: mediaWebhookDedupKey({ provider: "cloudinary", eventId: hash }),
      payloadHash: hash,
      state: "quarantined",
      processedAt: now,
      error: reason,
    })
    .onConflictDoNothing()
}

function eventPublicId(notification: Notification): string | null {
  if (notification.public_id) return notification.public_id
  if (notification.public_ids?.length === 1) return notification.public_ids[0]
  return null
}

async function processNotification(
  notification: Notification,
  rawBody: string,
  now: Date,
): Promise<ProcessOutcome> {
  const hash = payloadHash(rawBody)
  return db.transaction(async tx => {
    const publicId = eventPublicId(notification)
    const eventType = notification.notification_type ?? "upload"

    const insertEvent = async (input: {
      tenantId: string | null
      assetId: string | null
      state: "received" | "quarantined"
      error: string | null
    }) => {
      const [row] = await tx.insert(mediaProcessingEvents)
        .values({
          tenantId: input.tenantId,
          assetId: input.assetId,
          provider: "cloudinary",
          providerEventId: hash,
          dedupKey: mediaWebhookDedupKey({ provider: "cloudinary", eventId: hash }),
          payloadHash: hash,
          state: input.state,
          processedAt: now,
          error: input.error,
        })
        .onConflictDoNothing()
        .returning({ id: mediaProcessingEvents.id })
      return row?.id ?? null
    }

    const quarantine = async (reason: string, asset?: {
      id: string
      tenantId: string
      provider: string
      providerPublicId: string
      resourceType: string
      publication: string
    }, existingEventId?: string): Promise<ProcessOutcome> => {
      if (existingEventId) {
        await markEvent(tx, existingEventId, "quarantined", reason, now)
      } else {
        const eventId = await insertEvent({
          tenantId: asset?.tenantId ?? null,
          assetId: asset?.id ?? null,
          state: "quarantined",
          error: reason,
        })
        if (!eventId) return { status: "duplicate" }
      }
      if (!asset) return { status: "quarantined", reason }
      await tx.update(mediaAssets)
        .set({ state: "quarantined", publication: "withdrawn", updatedAt: now })
        .where(and(eq(mediaAssets.id, asset.id), eq(mediaAssets.tenantId, asset.tenantId)))
      await enqueueMediaCleanupJobs(tx, {
        tenantId: asset.tenantId,
        assetId: asset.id,
        provider: asset.provider,
        providerPublicId: asset.providerPublicId,
        providerResourceType: asset.resourceType,
        actions: ["destroy_provider_asset", "invalidate_delivery"],
      })
      return { status: "quarantined", reason }
    }

    if (eventType !== "upload" && eventType !== "delete") {
      return quarantine("unsupported_notification_type")
    }
    if (!publicId) return quarantine("missing_public_id")
    // Only server-issued media-plane ids are managed here. Legacy/arbitrary
    // Cloudinary objects are never adopted from a notification.
    if (!publicId.startsWith("ssl_")) return quarantine("unmanaged_public_id")
    if (notification.resource_type !== "image" && notification.resource_type !== "video") {
      return quarantine("unsupported_resource_type")
    }
    if (notification.type !== "authenticated" && notification.type !== "upload") {
      return quarantine("untrusted_delivery_type")
    }

    const rows = await tx
      .select({
        id: mediaAssets.id,
        tenantId: mediaAssets.tenantId,
        provider: mediaAssets.provider,
        providerPublicId: mediaAssets.providerPublicId,
        providerVersion: mediaAssets.providerVersion,
        resourceType: mediaAssets.resourceType,
        format: mediaAssets.format,
        bytes: mediaAssets.bytes,
        state: mediaAssets.state,
        publication: mediaAssets.publication,
      })
      .from(mediaAssets)
      .where(and(
        eq(mediaAssets.provider, "cloudinary"),
        eq(mediaAssets.providerPublicId, publicId),
      ))
      .for("update")
      .limit(2)
    if (rows.length === 0) return quarantine("asset_not_found")
    if (rows.length > 1) return quarantine("ambiguous_public_id")

    const asset = rows[0]
    const eventId = await insertEvent({
      tenantId: asset.tenantId,
      assetId: asset.id,
      state: "received",
      error: null,
    })
    if (!eventId) return { status: "duplicate" }

    if (eventType === "delete") {
      if (asset.state !== "deleted") {
        await tx.update(mediaAssets)
          .set({
            state: "deleted",
            publication: "withdrawn",
            deletedAt: now,
            updatedAt: now,
          })
          .where(and(eq(mediaAssets.id, asset.id), eq(mediaAssets.tenantId, asset.tenantId)))
        await enqueueMediaCleanupJobs(tx, {
          tenantId: asset.tenantId,
          assetId: asset.id,
          provider: asset.provider,
          providerPublicId: asset.providerPublicId,
          providerResourceType: asset.resourceType,
          actions: ["destroy_provider_asset", "invalidate_delivery"],
        })
      }
      await markEvent(tx, eventId, "applied", null, now)
      return { status: "applied" }
    }

    if (asset.state === "deleted" || asset.state === "quarantined") {
      await markEvent(tx, eventId, "applied", null, now)
      return { status: "applied" }
    }

    // Uploads use overwrite=false, so a different provider version means the
    // object was replaced outside this plane. Do not silently accept it.
    if (notification.version != null
      && asset.providerVersion != null
      && notification.version !== asset.providerVersion) {
      return quarantine("provider_version_changed", asset, eventId)
    }
    if (notification.bytes != null && asset.bytes != null
      && notification.bytes !== asset.bytes) {
      return quarantine("provider_bytes_mismatch", asset, eventId)
    }
    if (notification.format != null && asset.format != null
      && notification.format.trim().toLowerCase() !== asset.format.toLowerCase()) {
      return quarantine("provider_format_mismatch", asset, eventId)
    }
    if (asset.resourceType !== notification.resource_type) {
      return quarantine("provider_resource_type_mismatch", asset, eventId)
    }

    await markEvent(tx, eventId, "applied", null, now)
    return { status: "applied" }
  })
}

async function markEvent(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  eventId: string,
  state: "applied" | "quarantined",
  error: string | null,
  now: Date,
): Promise<void> {
  await tx.update(mediaProcessingEvents)
    .set({ state, error, processedAt: now })
    .where(eq(mediaProcessingEvents.id, eventId))
}
