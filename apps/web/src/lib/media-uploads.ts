import { randomUUID } from "node:crypto"
import { and, eq } from "drizzle-orm"
import { z } from "zod"
import { db, mediaAssets, mediaConsents, mediaQuotas, mediaUploadSessions } from "@mtk/database"
import {
  MEDIA_BINDING_TYPE_VALUES,
  authorizeMediaUploadRequestSchema,
  mediaLimitsFromEnv,
  mediaQuotaDecision,
  mediaUploadLimitDecision,
  mediaUploadSessionExpired,
  type MediaBindingType,
  type MediaConsentState,
  type MediaKind,
} from "./media-policy"
import {
  MEDIA_BINDING_PERMISSION,
  MediaAuthorizationError,
  assertMediaResourceAccess,
  requireMediaActor,
  requireMediaMember,
} from "./media-authorization"
import { hasPermission } from "./rbac"
import { enqueueMediaCleanupJobs } from "./media-cleanup"
import {
  buildUploadAuthorization,
  cloudinaryConfig,
  cloudinaryResourceType,
  fetchProviderAsset,
  publicDeliveryUrl,
  validateProviderAsset,
  type CloudinaryConfig,
  type ProviderAsset,
  type ProviderAssetValidation,
} from "./media-provider"

/**
 * ENH-07-02: authorize/finalize commands.
 *
 * Authorize is a closed decision: deploy limits, provider config, scoped
 * authority, quota and an unpredictable provider public id are all fixed
 * SERVER-side before a signature exists. The session is the only thing that can
 * be finalized, and finalize re-reads authoritative provider bytes/format -
 * a client declaration is a ceiling, never evidence.
 *
 * Provider I/O never runs inside a database transaction. The row is locked,
 * released, and re-locked around the network call so a duplicate finalize or an
 * expiry cannot double-count quota.
 */

export type MediaUploadErrorCode =
  | "invalid_request"
  | "limits_unconfigured"
  | "quota_unconfigured"
  | "quota_exceeded"
  | "provider_unconfigured"
  | "session_not_found"
  | "session_not_owner"
  | "session_expired"
  | "session_cancelled"
  | "already_finalized"
  | "provider_unavailable"
  | "provider_not_found"

export class MediaUploadError extends Error {
  constructor(
    readonly code: MediaUploadErrorCode,
    readonly detail?: string,
  ) {
    super(code)
    this.name = "MediaUploadError"
  }
}

const authorizeInputSchema = authorizeMediaUploadRequestSchema.extend({
  bindingType: z.enum(MEDIA_BINDING_TYPE_VALUES),
  resourceId: z.string().uuid(),
}).strict()

export type AuthorizeMediaUploadResult = {
  sessionId: string
  uploadUrl: string
  params: Record<string, string>
  expiresAt: string
}

export async function authorizeMediaUpload(input: unknown): Promise<AuthorizeMediaUploadResult> {
  const parsed = authorizeInputSchema.parse(input)
  const actor = await requireMediaActor(parsed.bindingType)
  await assertMediaResourceAccess({
    actor,
    bindingType: parsed.bindingType,
    resourceId: parsed.resourceId,
  })

  const limits = mediaLimitsFromEnv()
  const limit = mediaUploadLimitDecision(parsed, limits)
  if (!limit.allowed) {
    throw new MediaUploadError(
      limit.reason === "limits_unconfigured" ? "limits_unconfigured" : "invalid_request",
      limit.reason,
    )
  }

  const config = cloudinaryConfig()
  if (!config) throw new MediaUploadError("provider_unconfigured")

  const allowedFormats = mimeFormats(limits[parsed.kind]?.allowedMimeTypes ?? [])
  if (allowedFormats.length === 0) {
    // The deployment allowlist contained no format this provider can enforce.
    throw new MediaUploadError("invalid_request", "unsupported_mime")
  }

  const now = new Date()
  const publicId = `ssl_${randomUUID().replaceAll("-", "")}`
  const signed = buildUploadAuthorization({
    config,
    kind: parsed.kind,
    publicId,
    declaredBytes: parsed.bytes,
    allowedFormats,
    now,
  })

  const session = await db.transaction(async tx => {
    // One quota row per league. A missing row means no approved ceiling yet;
    // the decision below refuses, it does not create an unlimited quota.
    await tx.insert(mediaQuotas).values({ tenantId: actor.tenantId }).onConflictDoNothing()
    const [quota] = await tx
      .select({
        limitBytes: mediaQuotas.limitBytes,
        usedBytes: mediaQuotas.usedBytes,
        reservedBytes: mediaQuotas.reservedBytes,
      })
      .from(mediaQuotas)
      .where(eq(mediaQuotas.tenantId, actor.tenantId))
      .for("update")
      .limit(1)
    const decision = mediaQuotaDecision({
      limitBytes: quota?.limitBytes,
      usedBytes: quota?.usedBytes ?? 0,
      reservedBytes: quota?.reservedBytes ?? 0,
      requestedBytes: parsed.bytes,
    })
    if (!decision.allowed) {
      throw new MediaUploadError(
        decision.reason === "quota_unconfigured" ? "quota_unconfigured" : "quota_exceeded",
        decision.reason,
      )
    }

    const [created] = await tx
      .insert(mediaUploadSessions)
      .values({
        tenantId: actor.tenantId,
        userId: actor.actorId,
        kind: parsed.kind,
        state: "reserved",
        bindingType: parsed.bindingType,
        resourceId: parsed.resourceId,
        provider: "cloudinary",
        providerPublicId: publicId,
        declaredMimeType: parsed.mimeType.trim().toLowerCase(),
        declaredBytes: parsed.bytes,
        reservedBytes: parsed.bytes,
        expiresAt: signed.expiresAt,
      })
      .returning({ id: mediaUploadSessions.id })
    if (!created) throw new Error("Could not create the upload session")

    await tx.update(mediaQuotas)
      .set({ reservedBytes: decision.reservedAfter, updatedAt: now })
      .where(eq(mediaQuotas.tenantId, actor.tenantId))

    return created
  })

  return {
    sessionId: session.id,
    uploadUrl: signed.uploadUrl,
    params: signed.params,
    expiresAt: signed.expiresAt.toISOString(),
  }
}

const finalizeInputSchema = z.object({ sessionId: z.string().uuid() }).strict()

export type FinalizeMediaUploadResult =
  | {
      ok: true
      assetId: string
      state: "ready"
      publication: "unpublished"
    }
  | {
      ok: false
      reason: "quarantined"
      assetId: string
      detail: string
    }

type SessionRow = typeof mediaUploadSessions.$inferSelect

export async function finalizeMediaUpload(input: unknown): Promise<FinalizeMediaUploadResult> {
  const parsed = finalizeInputSchema.parse(input)
  const actor = await requireMediaMember()

  const [session] = await db
    .select()
    .from(mediaUploadSessions)
    .where(and(
      eq(mediaUploadSessions.id, parsed.sessionId),
      eq(mediaUploadSessions.tenantId, actor.tenantId),
    ))
    .limit(1)
  if (!session) throw new MediaUploadError("session_not_found")
  if (session.userId !== actor.actorId) throw new MediaUploadError("session_not_owner")
  if (session.state !== "reserved") throw sessionStateError(session)

  const bindingType = session.bindingType as MediaBindingType | null
  if (!bindingType || !session.resourceId) throw new MediaUploadError("invalid_request")
  if (!hasPermission(actor.role, MEDIA_BINDING_PERMISSION[bindingType])) {
    throw new MediaAuthorizationError("permission_denied")
  }
  await assertMediaResourceAccess({
    actor,
    bindingType,
    resourceId: session.resourceId,
  })

  const now = new Date()
  if (mediaUploadSessionExpired({ expiresAt: session.expiresAt, now })) {
    await expireReservedSession(session, now)
    throw new MediaUploadError("session_expired")
  }

  const limits = mediaLimitsFromEnv()
  const rule = limits[session.kind as MediaKind]
  if (!rule) throw new MediaUploadError("limits_unconfigured")

  const config = cloudinaryConfig()
  if (!config) throw new MediaUploadError("provider_unconfigured")

  // Network I/O happens OUTSIDE the transaction. Until the authoritative
  // answer is committed, the reservation stays held.
  const provider = await fetchProviderAsset({
    config,
    publicId: session.providerPublicId,
    kind: session.kind as MediaKind,
  })
  if (!provider.ok) {
    if (provider.reason === "provider_not_found") throw new MediaUploadError("provider_not_found")
    if (provider.reason === "provider_unavailable") throw new MediaUploadError("provider_unavailable")
    // An unparsable provider answer is not "ready". Commit a quarantined
    // evidence row and release the reservation.
    return db.transaction(tx => settleQuarantine(tx, {
      session,
      detail: provider.reason,
      asset: null,
      now,
    }))
  }

  const validation = validateProviderAsset({
    asset: provider.asset,
    expectedPublicId: session.providerPublicId,
    kind: session.kind as MediaKind,
    declaredMimeType: session.declaredMimeType,
    declaredBytes: session.declaredBytes,
    rule,
  })

  return db.transaction(async tx => {
    const [locked] = await tx
      .select()
      .from(mediaUploadSessions)
      .where(and(
        eq(mediaUploadSessions.id, session.id),
        eq(mediaUploadSessions.tenantId, actor.tenantId),
      ))
      .for("update")
      .limit(1)
    if (!locked) throw new MediaUploadError("session_not_found")
    if (locked.userId !== actor.actorId) throw new MediaUploadError("session_not_owner")
    if (locked.state !== "reserved") throw sessionStateError(locked)
    if (mediaUploadSessionExpired({ expiresAt: locked.expiresAt, now })) {
      await releaseReservation(tx, locked, "expired", now)
      return { expired: true as const }
    }

    if (!validation.ok) {
      return settleQuarantine(tx, {
        session: locked,
        detail: validation.reason,
        asset: provider.asset,
        now,
      })
    }
    return settleReady(tx, {
      session: locked,
      asset: provider.asset,
      validation,
      config,
      now,
    })
  }).then(result => {
    // Transaction results are committed at this point; only now is it safe to
    // surface expiry as an error.
    if ("expired" in result) throw new MediaUploadError("session_expired")
    return result
  })
}

function sessionStateError(session: SessionRow): MediaUploadError {
  if (session.state === "finalized") return new MediaUploadError("already_finalized")
  if (session.state === "cancelled") return new MediaUploadError("session_cancelled")
  return new MediaUploadError("session_expired")
}

async function expireReservedSession(session: SessionRow, now: Date): Promise<void> {
  await db.transaction(async tx => {
    const [locked] = await tx
      .select()
      .from(mediaUploadSessions)
      .where(and(
        eq(mediaUploadSessions.id, session.id),
        eq(mediaUploadSessions.state, "reserved"),
      ))
      .for("update")
      .limit(1)
    if (!locked) return
    if (!mediaUploadSessionExpired({ expiresAt: locked.expiresAt, now })) return
    await releaseReservation(tx, locked, "expired", now)
  })
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

async function releaseReservation(
  tx: Tx,
  session: SessionRow,
  state: "expired" | "cancelled",
  now: Date,
): Promise<void> {
  const [quota] = await tx
    .select({ reservedBytes: mediaQuotas.reservedBytes })
    .from(mediaQuotas)
    .where(eq(mediaQuotas.tenantId, session.tenantId))
    .for("update")
    .limit(1)
  if (quota) {
    await tx.update(mediaQuotas)
      .set({
        reservedBytes: Math.max(0, quota.reservedBytes - session.reservedBytes),
        updatedAt: now,
      })
      .where(eq(mediaQuotas.tenantId, session.tenantId))
  }
  await tx.update(mediaUploadSessions)
    .set({ state, finalizedAt: now })
    .where(and(
      eq(mediaUploadSessions.id, session.id),
      eq(mediaUploadSessions.state, "reserved"),
    ))
}

async function lockQuotaOrRefuse(tx: Tx, tenantId: string) {
  const [quota] = await tx
    .select({
      limitBytes: mediaQuotas.limitBytes,
      usedBytes: mediaQuotas.usedBytes,
      reservedBytes: mediaQuotas.reservedBytes,
    })
    .from(mediaQuotas)
    .where(eq(mediaQuotas.tenantId, tenantId))
    .for("update")
    .limit(1)
  if (!quota || quota.limitBytes == null) throw new MediaUploadError("quota_unconfigured")
  return quota
}

function consentFor(bindingType: MediaBindingType | null): MediaConsentState {
  // A person's photo (or match footage that can contain people) starts pending;
  // branding, venue, tournament and team marks carry no personal consent need.
  return bindingType === "player" || bindingType === "match" ? "pending" : "not_required"
}

async function settleReady(
  tx: Tx,
  input: {
    session: SessionRow
    asset: ProviderAsset
    validation: Extract<ProviderAssetValidation, { ok: true }>
    config: CloudinaryConfig
    now: Date
  },
): Promise<FinalizeMediaUploadResult> {
  const { session, asset, validation, config, now } = input
  const quota = await lockQuotaOrRefuse(tx, session.tenantId)

  const [created] = await tx
    .insert(mediaAssets)
    .values({
      tenantId: session.tenantId,
      provider: "cloudinary",
      providerPublicId: session.providerPublicId,
      providerAssetId: asset.assetId,
      providerVersion: asset.version,
      resourceType: asset.resourceType,
      kind: session.kind,
      state: "ready",
      publication: "unpublished",
      consent: consentFor(session.bindingType as MediaBindingType | null),
      mimeType: validation.mimeType,
      format: validation.format,
      bytes: validation.bytes,
      width: validation.width,
      height: validation.height,
      durationSeconds: validation.durationSeconds,
      metadata: {
        source: "provider_admin_api",
        deliveryUrl: publicDeliveryUrl({
          config,
          kind: session.kind as MediaKind,
          format: validation.format,
          publicId: session.providerPublicId,
          version: asset.version,
        }),
        providerCreatedAt: asset.createdAt,
      },
      createdBy: session.userId,
      readyAt: now,
    })
    .returning({ id: mediaAssets.id })
  if (!created) throw new Error("Could not record the verified asset")

  const consent = consentFor(session.bindingType as MediaBindingType | null)
  if (consent === "pending") {
    // Person-bearing media starts with an explicit asset-level consent row.
    // Publication stays blocked until it is granted; withdrawal later queues
    // provider destruction through the same cleanup outbox.
    await tx.insert(mediaConsents)
      .values({
        tenantId: session.tenantId,
        assetId: created.id,
        subjectUserId: null,
        purpose: "publication",
        state: "pending",
      })
      .onConflictDoNothing()
  }

  await tx.update(mediaQuotas)
    .set({
      reservedBytes: Math.max(0, quota.reservedBytes - session.reservedBytes),
      usedBytes: quota.usedBytes + Math.min(validation.bytes, session.reservedBytes),
      updatedAt: now,
    })
    .where(eq(mediaQuotas.tenantId, session.tenantId))

  const [finalized] = await tx.update(mediaUploadSessions)
    .set({ state: "finalized", assetId: created.id, finalizedAt: now })
    .where(and(
      eq(mediaUploadSessions.id, session.id),
      eq(mediaUploadSessions.state, "reserved"),
    ))
    .returning({ id: mediaUploadSessions.id })
  if (!finalized) throw new Error("The upload session was finalized concurrently")

  return { ok: true, assetId: created.id, state: "ready", publication: "unpublished" }
}

async function settleQuarantine(
  tx: Tx,
  input: {
    session: SessionRow
    detail: string
    asset: ProviderAsset | null
    now: Date
  },
): Promise<FinalizeMediaUploadResult> {
  const { session, detail, asset, now } = input
  const quota = await lockQuotaOrRefuse(tx, session.tenantId)

  // Keep the provider identity as evidence. Bytes stay NULL when the provider
  // did not give a verifiable value; we never copy the declaration into the
  // authoritative column.
  const [created] = await tx
    .insert(mediaAssets)
    .values({
      tenantId: session.tenantId,
      provider: "cloudinary",
      providerPublicId: session.providerPublicId,
      providerAssetId: asset?.assetId ?? null,
      providerVersion: asset?.version ?? null,
      resourceType: asset?.resourceType ?? cloudinaryResourceType(session.kind as MediaKind),
      kind: session.kind,
      state: "quarantined",
      publication: "unpublished",
      consent: consentFor(session.bindingType as MediaBindingType | null),
      mimeType: null,
      format: asset?.format ?? null,
      bytes: asset?.bytes ?? null,
      width: asset?.width ?? null,
      height: asset?.height ?? null,
      durationSeconds: asset?.durationSeconds ?? null,
      metadata: {
        source: "finalize_validation",
        reason: detail,
        providerCreatedAt: asset?.createdAt ?? null,
      },
      createdBy: session.userId,
    })
    .returning({ id: mediaAssets.id })
  if (!created) throw new Error("Could not record the quarantined asset")

  // A quarantined object may still exist at the provider. Keep its identity
  // and queue destruction in this same transaction; never leave a rejected
  // upload billable and addressable.
  await enqueueMediaCleanupJobs(tx, {
    tenantId: session.tenantId,
    assetId: created.id,
    provider: "cloudinary",
    providerPublicId: session.providerPublicId,
    providerResourceType: asset?.resourceType
      ?? cloudinaryResourceType(session.kind as MediaKind),
    actions: ["destroy_provider_asset", "invalidate_delivery"],
  })

  const counted = Math.min(asset?.bytes ?? 0, session.reservedBytes)
  await tx.update(mediaQuotas)
    .set({
      reservedBytes: Math.max(0, quota.reservedBytes - session.reservedBytes),
      usedBytes: quota.usedBytes + counted,
      updatedAt: now,
    })
    .where(eq(mediaQuotas.tenantId, session.tenantId))

  const [finalized] = await tx.update(mediaUploadSessions)
    .set({ state: "finalized", assetId: created.id, finalizedAt: now })
    .where(and(
      eq(mediaUploadSessions.id, session.id),
      eq(mediaUploadSessions.state, "reserved"),
    ))
    .returning({ id: mediaUploadSessions.id })
  if (!finalized) throw new Error("The upload session was finalized concurrently")

  return { ok: false, reason: "quarantined", assetId: created.id, detail }
}

/** Cloudinary `allowed_formats` takes extensions, not MIME strings. */
function mimeFormats(mimeTypes: readonly string[]): string[] {
  const map: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/avif": "avif",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
    "video/x-m4v": "m4v",
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
    "audio/mp4": "m4a",
    "audio/ogg": "ogg",
  }
  return [...new Set(mimeTypes.map(type => map[type.toLowerCase()]).filter((v): v is string => Boolean(v)))]
}
