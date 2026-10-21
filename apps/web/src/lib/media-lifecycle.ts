import { randomUUID } from "node:crypto"
import { and, eq } from "drizzle-orm"
import { auditLogs, db, mediaAssets } from "@mtk/database"
import { MediaAuthorizationError, requireMediaMember } from "./media-authorization"
import { enqueueMediaCleanupJobs } from "./media-cleanup"

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
