import { db, mediaAssets, tenants, type Media } from "@mtk/database"
import { and, eq } from "drizzle-orm"
import { z } from "zod"
import { cloudinaryConfig, privateDeliveryUrl } from "./media-provider"
import type { MediaKind } from "@mtk/database/lib/media-policy"
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

const CLOUDINARY_DELIVERY_HOST = "res.cloudinary.com"

/**
 * ENH-07-02 delivery: the one public locator the server is willing to hand out.
 *
 * The asset id alone is not authority. The row must be ready AND explicitly
 * published, its league must still be active, and the stored URL must be an
 * https Cloudinary delivery URL. Legacy/unverified rows, quarantined rows and
 * unpublished rows all collapse to null so the route cannot reveal lifecycle
 * state. Provider metadata (public id, version, raw payload) never leaves this
 * function.
 *
 * Originals uploaded as `authenticated` have no stored locator: a signed URL
 * that expires within minutes is minted here, per request, only after the
 * publication gate passes. Assets created before that change keep the stored
 * public URL.
 */
export async function findPublishedMediaDeliveryUrl(assetId: string): Promise<string | null> {
  const id = z.string().uuid().parse(assetId)
  const [row] = await db
    .select({
      state: mediaAssets.state,
      publication: mediaAssets.publication,
      metadata: mediaAssets.metadata,
      kind: mediaAssets.kind,
      format: mediaAssets.format,
      providerPublicId: mediaAssets.providerPublicId,
      tenantActive: tenants.isActive,
    })
    .from(mediaAssets)
    .innerJoin(tenants, eq(tenants.id, mediaAssets.tenantId))
    .where(eq(mediaAssets.id, id))
    .limit(1)
  if (!row || row.tenantActive !== true) return null
  const decision = mediaDeliveryDecision({
    state: row.state as MediaAssetState,
    publication: row.publication as MediaPublication,
    audience: "public",
  })
  if (!decision.allowed) return null
  const stored = cloudinaryDeliveryUrl(row.metadata)
  if (stored) return stored

  const deliveryType = (row.metadata as { deliveryType?: unknown } | null)?.deliveryType
  if (deliveryType !== "authenticated" || !row.format || !row.providerPublicId) return null
  const config = cloudinaryConfig()
  if (!config) return null
  return privateDeliveryUrl({
    config,
    kind: row.kind as MediaKind,
    format: row.format,
    publicId: row.providerPublicId,
  })
}

/** Accept only a plain https Cloudinary delivery URL; never a redirector or data URL. */
export function cloudinaryDeliveryUrl(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") return null
  const raw = (metadata as { deliveryUrl?: unknown }).deliveryUrl
  if (typeof raw !== "string" || raw.length > 2_048) return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== "https:" || url.hostname !== CLOUDINARY_DELIVERY_HOST) return null
  if (!url.pathname.startsWith("/") || url.pathname === "/") return null
  if (url.username || url.password) return null
  url.hash = ""
  return url.toString()
}
