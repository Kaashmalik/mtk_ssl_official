import { db, mediaAssets, type Media } from "@mtk/database"
import { and, eq } from "drizzle-orm"
import { z } from "zod"
import {
  classifyLegacyMedia,
  mediaDeliveryDecision,
  type MediaAssetState,
  type MediaDeliveryAudience,
  type MediaPublication,
} from "@mtk/database/lib/media-policy"

/**
 * ENH-07-01: media record projections.
 *
 * The legacy `media` table is NOT upgraded by inference. Its rows are returned
 * as `legacy_unverified` / `unpublished` with an explicit re-check requirement;
 * a stored URL is a locator, not evidence of provider identity, content safety
 * or consent.
 *
 * Verified asset projections deliberately omit provider public ids, provider
 * metadata and legacy URLs. A public/member reader receives only descriptive
 * fields after the shared delivery gate allows it.
 */

export type LegacyMediaRecord = {
  id: string
  state: "legacy_unverified"
  publication: "unpublished"
  needsAuthoritativeRecheck: true
  source: "legacy"
}

/** Classify a pre-contract row without ever promoting it. */
export function legacyMediaRecord(row: Pick<Media, "id">): LegacyMediaRecord {
  return { id: row.id, ...classifyLegacyMedia(), source: "legacy" }
}

export type PublicMediaRecord = {
  id: string
  kind: string
  format: string | null
  width: number | null
  height: number | null
  durationSeconds: number | null
}

type AssetProjection = {
  id: string
  kind: string
  state: string
  publication: string
  format: string | null
  width: number | null
  height: number | null
  durationSeconds: number | null
}

/**
 * Provider-free projection for a reader. Returns null when the shared delivery
 * decision refuses; it never "falls back" to a legacy URL.
 */
export function toPublicMediaRecord(
  asset: AssetProjection,
  audience: MediaDeliveryAudience = "public",
): PublicMediaRecord | null {
  const decision = mediaDeliveryDecision({
    state: asset.state as MediaAssetState,
    publication: asset.publication as MediaPublication,
    audience,
  })
  if (!decision.allowed) return null
  return {
    id: asset.id,
    kind: asset.kind,
    format: asset.format,
    width: asset.width,
    height: asset.height,
    durationSeconds: asset.durationSeconds,
  }
}

/**
 * Tenant-scoped verified read. The id alone is never sufficient: a foreign
 * tenant's asset resolves to null, not to someone else's media.
 */
export async function findDeliverableMediaAsset(input: {
  tenantId: string
  assetId: string
  audience?: MediaDeliveryAudience
}): Promise<PublicMediaRecord | null> {
  const tenantId = z.string().uuid().parse(input.tenantId)
  const assetId = z.string().uuid().parse(input.assetId)
  const [asset] = await db
    .select({
      id: mediaAssets.id,
      kind: mediaAssets.kind,
      state: mediaAssets.state,
      publication: mediaAssets.publication,
      format: mediaAssets.format,
      width: mediaAssets.width,
      height: mediaAssets.height,
      durationSeconds: mediaAssets.durationSeconds,
    })
    .from(mediaAssets)
    .where(and(eq(mediaAssets.tenantId, tenantId), eq(mediaAssets.id, assetId)))
    .limit(1)
  if (!asset) return null
  return toPublicMediaRecord(asset, input.audience ?? "public")
}
