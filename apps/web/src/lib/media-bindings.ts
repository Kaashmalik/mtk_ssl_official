import { randomUUID } from "node:crypto"
import { and, eq } from "drizzle-orm"
import { auditLogs, db, mediaAssets, mediaBindings } from "@mtk/database"
import { z } from "zod"
import {
  assertMediaResourceAccess,
  requireMediaActor,
} from "./media-authorization"
import {
  MEDIA_BINDING_TYPE_VALUES,
  MEDIA_ROLE_VALUES,
  mediaBindingDecision,
  type MediaAssetState,
  type MediaBindingType,
  type MediaRole,
} from "./media-policy"

/**
 * ENH-07-04: attach a verified media asset to a domain resource.
 *
 * Binding is NOT publication. It records "this verified asset is the logo for
 * this team"; the asset can still be unpublished until consent/publication
 * gates pass. Authority composes the class permission for the binding type and
 * the same durable team/player grant used by uploads. The composite asset/
 * tenant FK means a cross-tenant attachment fails in the database even if an
 * application check is bypassed.
 *
 * Roles are deliberately constrained per resource: a match cannot have a
 * "logo", a player cannot have a "highlight". The database check owns the
 * vocabulary; this map owns the sensible pairings.
 */

const ROLE_BY_BINDING: Record<MediaBindingType, readonly MediaRole[]> = {
  branding: ["logo", "banner", "thumbnail"],
  tournament: ["logo", "banner", "thumbnail", "gallery"],
  venue: ["logo", "banner", "gallery"],
  team: ["logo", "banner", "gallery", "avatar"],
  player: ["avatar", "gallery", "thumbnail"],
  match: ["thumbnail", "highlight", "gallery"],
}

export const bindMediaAssetSchema = z.object({
  bindingType: z.enum(MEDIA_BINDING_TYPE_VALUES),
  resourceId: z.string().uuid(),
  role: z.enum(MEDIA_ROLE_VALUES),
}).strict()

export type BindMediaAssetInput = z.input<typeof bindMediaAssetSchema>

export type BindMediaAssetResult =
  | { ok: true; bindingId: string; assetId: string; created: boolean }
  | {
      ok: false
      reason:
        | "not_found"
        | "foreign_tenant"
        | "resource_tenant_mismatch"
        | "asset_not_ready"
        | "asset_quarantined"
        | "role_not_allowed"
    }

export async function bindMediaAsset(
  assetId: string,
  input: unknown,
): Promise<BindMediaAssetResult> {
  const parsed = bindMediaAssetSchema.parse(input)
  if (!ROLE_BY_BINDING[parsed.bindingType].includes(parsed.role)) {
    return { ok: false, reason: "role_not_allowed" }
  }

  const actor = await requireMediaActor(parsed.bindingType)
  await assertMediaResourceAccess({
    actor,
    bindingType: parsed.bindingType,
    resourceId: parsed.resourceId,
  })

  return db.transaction(async tx => {
    const [asset] = await tx
      .select({
        id: mediaAssets.id,
        tenantId: mediaAssets.tenantId,
        state: mediaAssets.state,
      })
      .from(mediaAssets)
      .where(and(
        eq(mediaAssets.id, assetId),
        eq(mediaAssets.tenantId, actor.tenantId),
      ))
      .for("update")
      .limit(1)
    if (!asset) return { ok: false, reason: "not_found" }

    const decision = mediaBindingDecision({
      requestTenantId: actor.tenantId,
      assetTenantId: asset.tenantId,
      // assertMediaResourceAccess already proved the resource is in this
      // tenant (or is the tenant itself for branding).
      resourceTenantId: actor.tenantId,
      assetState: asset.state as MediaAssetState,
    })
    if (!decision.allowed) return { ok: false, reason: decision.reason }

    const [created] = await tx.insert(mediaBindings)
      .values({
        tenantId: actor.tenantId,
        assetId: asset.id,
        resourceType: parsed.bindingType,
        resourceId: parsed.resourceId,
        role: parsed.role,
        createdBy: actor.actorId,
      })
      .onConflictDoNothing()
      .returning({ id: mediaBindings.id })
    if (created) {
      await writeBindingAudit(tx, actor, asset.id, "MEDIA_ASSET_BOUND", {
        bindingId: created.id,
        bindingType: parsed.bindingType,
        resourceId: parsed.resourceId,
        role: parsed.role,
      })
      return {
        ok: true,
        bindingId: created.id,
        assetId: asset.id,
        created: true,
      }
    }

    // The unique key is (asset, resource type, resource id, role). A duplicate
    // is an idempotent repeat, not an error and not a second audit row.
    const [existing] = await tx
      .select({ id: mediaBindings.id })
      .from(mediaBindings)
      .where(and(
        eq(mediaBindings.tenantId, actor.tenantId),
        eq(mediaBindings.assetId, asset.id),
        eq(mediaBindings.resourceType, parsed.bindingType),
        eq(mediaBindings.resourceId, parsed.resourceId),
        eq(mediaBindings.role, parsed.role),
      ))
      .limit(1)
    if (!existing) throw new Error("Binding conflict could not be resolved")
    return {
      ok: true,
      bindingId: existing.id,
      assetId: asset.id,
      created: false,
    }
  })
}

export type UnbindMediaAssetResult =
  | { ok: true; bindingId: string }
  | { ok: false; reason: "not_found" }

export async function unbindMediaAsset(input: {
  assetId: string
  bindingId: string
}): Promise<UnbindMediaAssetResult> {
  z.string().uuid().parse(input.assetId)
  z.string().uuid().parse(input.bindingId)

  // Read the resource identity before authorizing the class permission.
  const [binding] = await db
    .select({
      id: mediaBindings.id,
      tenantId: mediaBindings.tenantId,
      assetId: mediaBindings.assetId,
      resourceType: mediaBindings.resourceType,
      resourceId: mediaBindings.resourceId,
    })
    .from(mediaBindings)
    .where(and(
      eq(mediaBindings.id, input.bindingId),
      eq(mediaBindings.assetId, input.assetId),
    ))
    .limit(1)
  if (!binding) return { ok: false, reason: "not_found" }

  const actor = await requireMediaActor(binding.resourceType as MediaBindingType)
  if (binding.tenantId !== actor.tenantId) return { ok: false, reason: "not_found" }
  await assertMediaResourceAccess({
    actor,
    bindingType: binding.resourceType as MediaBindingType,
    resourceId: binding.resourceId,
  })

  return db.transaction(async tx => {
    const [deleted] = await tx.delete(mediaBindings)
      .where(and(
        eq(mediaBindings.id, binding.id),
        eq(mediaBindings.assetId, input.assetId),
        eq(mediaBindings.tenantId, actor.tenantId),
      ))
      .returning({ id: mediaBindings.id })
    if (!deleted) return { ok: false, reason: "not_found" }
    await writeBindingAudit(tx, actor, binding.assetId, "MEDIA_ASSET_UNBOUND", {
      bindingId: binding.id,
      bindingType: binding.resourceType,
      resourceId: binding.resourceId,
    })
    return { ok: true, bindingId: deleted.id }
  })
}

async function writeBindingAudit(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  actor: { tenantId: string; actorId: string; role: string },
  assetId: string,
  method: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await tx.insert(auditLogs).values({
    requestId: randomUUID(),
    tenantId: actor.tenantId,
    actorId: actor.actorId,
    actorRole: actor.role,
    method,
    path: `/api/media/${assetId}/bindings`,
    statusCode: "200",
    payload,
  })
}
