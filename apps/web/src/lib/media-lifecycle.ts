import { randomUUID } from "node:crypto"
import { and, eq, isNull } from "drizzle-orm"
import { auditLogs, db, mediaAssets, mediaConsents } from "@mtk/database"
import { MediaAuthorizationError, requireMediaMember } from "./media-authorization"
import { enqueueMediaCleanupJobs } from "./media-cleanup"
import {
  mediaPublicationDecision,
  type MediaAssetState,
  type MediaConsentState,
  type MediaPublication,
} from "./media-policy"

/**
 * ENH-07-03: tombstone deletion.
 *
 * Deleting media never hard-deletes the asset row: the tombstone keeps the
 * provider public id/resource type so the durable cleanup worker can still
 * find and destroy the object. Publication is withdrawn immediately, so no
 * delivery gate can serve it while destruction is pending.
 *
 * Owner-only for now: bindings are not yet materialized, so there is no
 * resource grant to compose against. This is deliberately narrower than the
 * upload authority.
 */
export type DeleteMediaAssetResult =
  | { ok: true; assetId: string; cleanupJobs: number }
  | { ok: false; reason: "not_found" }

export async function deleteMediaAsset(input: { assetId: string }): Promise<DeleteMediaAssetResult> {
  const actor = await requireMediaMember()
  if (actor.role !== "league_owner") throw new MediaAuthorizationError("permission_denied")

  return db.transaction(async tx => {
    const [asset] = await tx
      .select({
        id: mediaAssets.id,
        tenantId: mediaAssets.tenantId,
        provider: mediaAssets.provider,
        providerPublicId: mediaAssets.providerPublicId,
        resourceType: mediaAssets.resourceType,
        state: mediaAssets.state,
      })
      .from(mediaAssets)
      .where(and(
        eq(mediaAssets.id, input.assetId),
        eq(mediaAssets.tenantId, actor.tenantId),
      ))
      .for("update")
      .limit(1)
    if (!asset) return { ok: false, reason: "not_found" }
    if (asset.state === "deleted") {
      return { ok: true, assetId: asset.id, cleanupJobs: 0 }
    }

    const now = new Date()
    await tx.update(mediaAssets)
      .set({
        state: "deleted",
        publication: "withdrawn",
        deletedAt: now,
        updatedAt: now,
      })
      .where(and(eq(mediaAssets.id, asset.id), eq(mediaAssets.tenantId, actor.tenantId)))

    const cleanupJobs = await enqueueMediaCleanupJobs(tx, {
      tenantId: asset.tenantId,
      assetId: asset.id,
      provider: asset.provider,
      providerPublicId: asset.providerPublicId,
      providerResourceType: asset.resourceType,
      actions: ["destroy_provider_asset", "invalidate_delivery"],
    })

    await tx.insert(auditLogs).values({
      requestId: randomUUID(),
      tenantId: actor.tenantId,
      actorId: actor.actorId,
      actorRole: actor.role,
      method: "MEDIA_ASSET_DELETE",
      path: `/api/media/${asset.id}`,
      statusCode: "200",
      payload: {
        assetId: asset.id,
        providerPublicId: asset.providerPublicId,
        state: "deleted",
        publication: "withdrawn",
        cleanupJobs,
      },
    })

    return { ok: true, assetId: asset.id, cleanupJobs }
  })
}

const CONSENT_PURPOSE = "publication"

export type RecordMediaConsentResult =
  | {
      ok: true
      assetId: string
      state: "granted" | "withdrawn"
      cleanupJobs: number
    }
  | { ok: false; reason: "not_found" | "asset_not_available" }

/**
 * Asset-level publication consent. A person-bearing asset starts `pending`;
 * granting unlocks publication, withdrawal is privacy-first: it withdraws
 * publication, tombstones the asset and queues provider destruction while
 * preserving the provider identity.
 *
 * Owner-only until product/legal defines who may evidence consent for a player.
 * The consent row is updated in place under the asset lock, so concurrent
 * grant/withdraw cannot leave the asset and evidence disagreeing.
 */
export async function recordMediaConsent(input: {
  assetId: string
  state: "granted" | "withdrawn"
  evidenceRef?: string
}): Promise<RecordMediaConsentResult> {
  const actor = await requireMediaMember()
  if (actor.role !== "league_owner") throw new MediaAuthorizationError("permission_denied")

  return db.transaction(async tx => {
    const [asset] = await tx
      .select({
        id: mediaAssets.id,
        tenantId: mediaAssets.tenantId,
        provider: mediaAssets.provider,
        providerPublicId: mediaAssets.providerPublicId,
        resourceType: mediaAssets.resourceType,
        state: mediaAssets.state,
        consent: mediaAssets.consent,
      })
      .from(mediaAssets)
      .where(and(
        eq(mediaAssets.id, input.assetId),
        eq(mediaAssets.tenantId, actor.tenantId),
      ))
      .for("update")
      .limit(1)
    if (!asset) return { ok: false, reason: "not_found" }

    const now = new Date()
    if (input.state === "granted") {
      if (asset.state !== "ready") return { ok: false, reason: "asset_not_available" }
      await tx.update(mediaAssets)
        .set({ consent: "granted", updatedAt: now })
        .where(and(eq(mediaAssets.id, asset.id), eq(mediaAssets.tenantId, actor.tenantId)))
      await writeConsent(tx, {
        tenantId: asset.tenantId,
        assetId: asset.id,
        state: "granted",
        evidenceRef: input.evidenceRef ?? null,
        now,
      })
      await audit(tx, actor, asset.id, "MEDIA_CONSENT_GRANTED", {
        assetId: asset.id,
        state: "granted",
        hasEvidence: Boolean(input.evidenceRef),
      })
      return { ok: true, assetId: asset.id, state: "granted", cleanupJobs: 0 }
    }

    if (asset.consent === "withdrawn" && asset.state === "deleted") {
      return { ok: true, assetId: asset.id, state: "withdrawn", cleanupJobs: 0 }
    }

    await tx.update(mediaAssets)
      .set({
        consent: "withdrawn",
        state: "deleted",
        publication: "withdrawn",
        deletedAt: now,
        updatedAt: now,
      })
      .where(and(eq(mediaAssets.id, asset.id), eq(mediaAssets.tenantId, actor.tenantId)))
    await writeConsent(tx, {
      tenantId: asset.tenantId,
      assetId: asset.id,
      state: "withdrawn",
      evidenceRef: input.evidenceRef ?? null,
      now,
    })
    const cleanupJobs = await enqueueMediaCleanupJobs(tx, {
      tenantId: asset.tenantId,
      assetId: asset.id,
      provider: asset.provider,
      providerPublicId: asset.providerPublicId,
      providerResourceType: asset.resourceType,
      actions: ["destroy_provider_asset", "invalidate_delivery"],
    })
    await audit(tx, actor, asset.id, "MEDIA_CONSENT_WITHDRAWN", {
      assetId: asset.id,
      state: "withdrawn",
      cleanupJobs,
    })
    return { ok: true, assetId: asset.id, state: "withdrawn", cleanupJobs }
  })
}

export type SetMediaPublicationResult =
  | {
      ok: true
      assetId: string
      publication: "published" | "unpublished" | "withdrawn"
    }
  | {
      ok: false
      reason:
        | "not_found"
        | "asset_not_available"
        | "asset_not_ready"
        | "asset_quarantined"
        | "consent_pending"
        | "consent_withdrawn"
        | "already_withdrawn"
    }

/**
 * Server-authoritative publication state. A ready asset is NOT public: publish
 * is refused while consent is pending/withdrawn and can only be reversed to
 * `unpublished` (republishable) or `withdrawn` (terminal). Withdrawal queues
 * delivery invalidation but intentionally retains the provider original for
 * rollback; deleting the asset is a separate destructive command.
 */
export async function setMediaPublication(input: {
  assetId: string
  action: "publish" | "unpublish" | "withdraw"
}): Promise<SetMediaPublicationResult> {
  const actor = await requireMediaMember()
  if (actor.role !== "league_owner") throw new MediaAuthorizationError("permission_denied")

  return db.transaction(async tx => {
    const [asset] = await tx
      .select({
        id: mediaAssets.id,
        tenantId: mediaAssets.tenantId,
        state: mediaAssets.state,
        consent: mediaAssets.consent,
        publication: mediaAssets.publication,
        provider: mediaAssets.provider,
        providerPublicId: mediaAssets.providerPublicId,
        resourceType: mediaAssets.resourceType,
      })
      .from(mediaAssets)
      .where(and(
        eq(mediaAssets.id, input.assetId),
        eq(mediaAssets.tenantId, actor.tenantId),
      ))
      .for("update")
      .limit(1)
    if (!asset) return { ok: false, reason: "not_found" }

    const now = new Date()
    if (input.action === "publish") {
      const decision = mediaPublicationDecision({
        state: asset.state as MediaAssetState,
        consent: asset.consent as MediaConsentState,
        publication: asset.publication as MediaPublication,
      })
      if (!decision.allowed) return { ok: false, reason: decision.reason }
      await tx.update(mediaAssets)
        .set({ publication: "published", updatedAt: now })
        .where(and(eq(mediaAssets.id, asset.id), eq(mediaAssets.tenantId, actor.tenantId)))
      await audit(tx, actor, asset.id, "MEDIA_ASSET_PUBLISHED", {
        assetId: asset.id,
        consent: asset.consent,
      }, "publication")
      return { ok: true, assetId: asset.id, publication: "published" }
    }

    if (input.action === "unpublish") {
      if (asset.state === "deleted" || asset.publication === "withdrawn") {
        return { ok: false, reason: "asset_not_available" }
      }
      await tx.update(mediaAssets)
        .set({ publication: "unpublished", updatedAt: now })
        .where(and(eq(mediaAssets.id, asset.id), eq(mediaAssets.tenantId, actor.tenantId)))
      await audit(tx, actor, asset.id, "MEDIA_ASSET_UNPUBLISHED", {
        assetId: asset.id,
      }, "publication")
      return { ok: true, assetId: asset.id, publication: "unpublished" }
    }

    if (asset.publication === "withdrawn") {
      return { ok: true, assetId: asset.id, publication: "withdrawn" }
    }
    await tx.update(mediaAssets)
      .set({ publication: "withdrawn", updatedAt: now })
      .where(and(eq(mediaAssets.id, asset.id), eq(mediaAssets.tenantId, actor.tenantId)))
    await enqueueMediaCleanupJobs(tx, {
      tenantId: asset.tenantId,
      assetId: asset.id,
      provider: asset.provider,
      providerPublicId: asset.providerPublicId,
      providerResourceType: asset.resourceType,
      actions: ["invalidate_delivery"],
    })
    await audit(tx, actor, asset.id, "MEDIA_ASSET_WITHDRAWN", {
      assetId: asset.id,
    }, "publication")
    return { ok: true, assetId: asset.id, publication: "withdrawn" }
  })
}

async function writeConsent(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  input: {
    tenantId: string
    assetId: string
    state: "granted" | "withdrawn"
    evidenceRef: string | null
    now: Date
  },
): Promise<void> {
  const [existing] = await tx.update(mediaConsents)
    .set({
      state: input.state,
      evidenceRef: input.evidenceRef,
      updatedAt: input.now,
      ...(input.state === "granted"
        ? { grantedAt: input.now, withdrawnAt: null }
        : { withdrawnAt: input.now }),
    })
    .where(and(
      eq(mediaConsents.assetId, input.assetId),
      eq(mediaConsents.tenantId, input.tenantId),
      eq(mediaConsents.purpose, CONSENT_PURPOSE),
      isNull(mediaConsents.subjectUserId),
    ))
    .returning({ id: mediaConsents.id })
  if (existing) return
  await tx.insert(mediaConsents).values({
    tenantId: input.tenantId,
    assetId: input.assetId,
    subjectUserId: null,
    purpose: CONSENT_PURPOSE,
    state: input.state,
    evidenceRef: input.evidenceRef,
    ...(input.state === "granted"
      ? { grantedAt: input.now }
      : { withdrawnAt: input.now }),
  })
}

async function audit(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  actor: { tenantId: string; actorId: string; role: string },
  assetId: string,
  method: string,
  payload: Record<string, unknown>,
  pathSuffix = "consent",
): Promise<void> {
  await tx.insert(auditLogs).values({
    requestId: randomUUID(),
    tenantId: actor.tenantId,
    actorId: actor.actorId,
    actorRole: actor.role,
    method,
    path: `/api/media/${assetId}/${pathSuffix}`,
    statusCode: "200",
    payload,
  })
}
