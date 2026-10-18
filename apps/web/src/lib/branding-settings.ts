import { randomUUID } from "crypto"
import { auditLogs, db, getPlanLimits, tenantBranding, tenants } from "@mtk/database"
import { eq, sql } from "drizzle-orm"
import type { PlanKey } from "@mtk/database"

/**
 * League branding settings (super-admin gated in the route). All writes go
 * through one tenant-locked transaction so plan gating is evaluated against
 * the plan read under the lock — a concurrent plan change (e.g. the Stripe
 * settlement downgrade) cannot race a white-label write past the gate.
 */

/** Fields reserved for white-label plans (pro and up). */
const GATED_FIELDS = [
  "hideSslBranding",
  "fontFamily",
  "mobileAppIconUrl",
  "mobileAppSplashUrl",
  "mobileAppBundleId",
  "mobileAppPackageName",
] as const

export interface BrandingSettingsData {
  logoUrl?: string | null
  faviconUrl?: string | null
  primaryColor?: string | null
  secondaryColor?: string | null
  accentColor?: string | null
  fontFamily?: string | null
  appName?: string | null
  hideSslBranding?: boolean
  emailSenderName?: string | null
  emailSenderAddress?: string | null
  mobileAppIconUrl?: string | null
  mobileAppSplashUrl?: string | null
  mobileAppBundleId?: string | null
  mobileAppPackageName?: string | null
  customCss?: string | null
  loginPageBackgroundUrl?: string | null
  loginPageCustomHtml?: string | null
  customDomain?: string | null
}

/**
 * Plan-based feature gating. White-label (hideSslBranding, custom fonts,
 * mobile app branding) requires pro or enterprise; custom domain requires
 * enterprise. Returns the client-facing rejection message, or null when the
 * request is allowed.
 */
export function brandingPlanViolation(
  plan: PlanKey,
  data: BrandingSettingsData,
): string | null {
  const planLimits = getPlanLimits(plan)
  const isWhiteLabelAllowed = planLimits.whiteLabel === true

  if (!isWhiteLabelAllowed) {
    const requestedGatedField = GATED_FIELDS.find(
      (f) => data[f] !== undefined && data[f] !== null && data[f] !== false,
    )
    if (requestedGatedField) {
      return `White-label customization (${requestedGatedField}) requires Pro or Enterprise plan. Please upgrade your plan.`
    }
  }

  if (data.customDomain && !planLimits.customDomain) {
    return "Custom domains require Enterprise plan. Please upgrade your plan."
  }

  return null
}

export async function getBrandingSettings(
  tenantId: string,
): Promise<{ tenant: typeof tenants.$inferSelect; branding: typeof tenantBranding.$inferSelect | null } | { missing: true }> {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1)
  if (!tenant) return { missing: true }

  const [branding] = await db
    .select()
    .from(tenantBranding)
    .where(eq(tenantBranding.tenantId, tenantId))
    .limit(1)

  return { tenant, branding: branding ?? null }
}

/**
 * Brand Studio (PREM-02, Batch 135): branding edits are saved as a DRAFT,
 * published into the active snapshot, and one-step rollback restores the
 * previous snapshot. The same tenant-locked transaction discipline as
 * saveBrandingSettings: plan gating evaluates against the plan read under
 * the lock, so a concurrent downgrade cannot smuggle a gated value into a
 * draft or a publication. Publish consumes the draft; rollback swaps the
 * snapshot pair under the lock; both are audited, and a replay (nothing to
 * publish, no previous snapshot) is an honest pure read.
 */

const brandingValuesOf = (data: BrandingSettingsData) => ({
  logoUrl: data.logoUrl || null,
  faviconUrl: data.faviconUrl || null,
  primaryColor: data.primaryColor || null,
  secondaryColor: data.secondaryColor || null,
  accentColor: data.accentColor || null,
  fontFamily: data.fontFamily || null,
  appName: data.appName || null,
  hideSslBranding: data.hideSslBranding || false,
  emailSenderName: data.emailSenderName || null,
  emailSenderAddress: data.emailSenderAddress || null,
  mobileAppIconUrl: data.mobileAppIconUrl || null,
  mobileAppSplashUrl: data.mobileAppSplashUrl || null,
  mobileAppBundleId: data.mobileAppBundleId || null,
  mobileAppPackageName: data.mobileAppPackageName || null,
  customCss: data.customCss ?? null,
  loginPageBackgroundUrl: data.loginPageBackgroundUrl ?? null,
  loginPageCustomHtml: data.loginPageCustomHtml ?? null,
})

export type BrandingValues = ReturnType<typeof brandingValuesOf>

export async function saveBrandingDraft(input: {
  tenantId: string
  data: BrandingSettingsData
}): Promise<{ ok: true; draft: BrandingValues } | { missing: true } | { violation: string }> {
  const { tenantId, data } = input
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT ${tenants.id} FROM ${tenants} WHERE ${tenants.id} = ${tenantId} FOR UPDATE`)
    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1)
    if (!tenant) return { missing: true as const }
    const violation = brandingPlanViolation(tenant.plan as PlanKey, data)
    if (violation) return { violation }
    const draft = brandingValuesOf(data)
    const [existing] = await tx
      .select({ tenantId: tenantBranding.tenantId })
      .from(tenantBranding)
      .where(eq(tenantBranding.tenantId, tenantId))
      .limit(1)
    if (existing) {
      await tx.update(tenantBranding).set({ draft, updatedAt: new Date() }).where(eq(tenantBranding.tenantId, tenantId))
    } else {
      await tx.insert(tenantBranding).values({ tenantId, draft })
    }
    await auditBranding(tx, tenantId, "BRAND_DRAFT_SAVED", { fields: Object.keys(draft).length })
    return { ok: true as const, draft }
  })
}

export async function publishBrandingDraft(input: {
  tenantId: string
}): Promise<{ ok: true; published: BrandingValues } | { missing: true } | { nothingToPublish: true }> {
  const { tenantId } = input
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT ${tenants.id} FROM ${tenants} WHERE ${tenants.id} = ${tenantId} FOR UPDATE`)
    const [branding] = await tx.select().from(tenantBranding).where(eq(tenantBranding.tenantId, tenantId)).limit(1)
    if (!branding) return { missing: true as const }
    const draft = (branding.draft ?? null) as BrandingValues | null
    if (!draft || typeof draft !== "object") return { nothingToPublish: true as const }
    await tx.update(tenantBranding).set({
      published: draft,
      previousPublished: (branding.published ?? null) as BrandingValues | null,
      publishedAt: new Date(),
      draft: null,
      updatedAt: new Date(),
    }).where(eq(tenantBranding.tenantId, tenantId))
    await auditBranding(tx, tenantId, "BRAND_PUBLISHED", {})
    return { ok: true as const, published: draft }
  })
}

export async function rollbackBranding(input: {
  tenantId: string
}): Promise<{ ok: true; published: BrandingValues | null } | { changed: false } | { missing: true }> {
  const { tenantId } = input
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT ${tenants.id} FROM ${tenants} WHERE ${tenants.id} = ${tenantId} FOR UPDATE`)
    const [branding] = await tx.select().from(tenantBranding).where(eq(tenantBranding.tenantId, tenantId)).limit(1)
    if (!branding) return { missing: true as const }
    const previous = (branding.previousPublished ?? null) as BrandingValues | null
    // A first publish has no previous snapshot: the rollback replay answers
    // honestly instead of fabricating a revert.
    if (!previous) return { changed: false as const }
    await tx.update(tenantBranding).set({
      published: previous,
      previousPublished: (branding.published ?? null) as BrandingValues | null,
      publishedAt: new Date(),
      draft: null,
      updatedAt: new Date(),
    }).where(eq(tenantBranding.tenantId, tenantId))
    await auditBranding(tx, tenantId, "BRAND_ROLLBACK", {})
    return { ok: true as const, published: previous }
  })
}

/**
 * The ACTIVE branding a public/sign-in surface renders: the published
 * snapshot when one exists; legacy rows (no snapshot) keep rendering their
 * own columns so nothing regresses before a league's first publish.
 */
export function activeBrandingSnapshot(
  branding: typeof tenantBranding.$inferSelect | null,
): BrandingValues | null {
  if (!branding) return null
  const published = (branding.published ?? null) as BrandingValues | null
  if (published && typeof published === "object") return published
  return brandingValuesOf({
    logoUrl: branding.logoUrl,
    faviconUrl: branding.faviconUrl,
    primaryColor: branding.primaryColor,
    secondaryColor: branding.secondaryColor,
    accentColor: branding.accentColor,
    fontFamily: branding.fontFamily,
    appName: branding.appName,
    hideSslBranding: branding.hideSslBranding,
    emailSenderName: branding.emailSenderName,
    emailSenderAddress: branding.emailSenderAddress,
    mobileAppIconUrl: branding.mobileAppIconUrl,
    mobileAppSplashUrl: branding.mobileAppSplashUrl,
    mobileAppBundleId: branding.mobileAppBundleId,
    mobileAppPackageName: branding.mobileAppPackageName,
    customCss: branding.customCss,
    loginPageBackgroundUrl: branding.loginPageBackgroundUrl,
    loginPageCustomHtml: branding.loginPageCustomHtml,
  })
}

async function auditBranding(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  tenantId: string,
  method: string,
  payload: Record<string, unknown>,
) {
  await tx.insert(auditLogs).values({ requestId: randomUUID(), tenantId, actorId: null, method,
    path: "/api/settings/branding", statusCode: "200", payload })
}

/**
 * Apply branding settings in one transaction: lock the tenant row, re-read
 * the plan under the lock for gating, then update the custom domain (when
 * provided) and upsert the branding row. `tenantId` is the branding table's
 * primary key, so the insert cannot silently duplicate.
 */
export async function saveBrandingSettings(input: {
  tenantId: string
  data: BrandingSettingsData
}): Promise<{ ok: true } | { missing: true } | { violation: string }> {
  const { tenantId, data } = input

  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT ${tenants.id} FROM ${tenants} WHERE ${tenants.id} = ${tenantId} FOR UPDATE`)

    const [tenant] = await tx.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1)
    if (!tenant) return { missing: true as const }

    // Gating against the plan read under the lock, not a stale pre-transaction read.
    const violation = brandingPlanViolation(tenant.plan as PlanKey, data)
    if (violation) return { violation }

    if (data.customDomain !== undefined) {
      await tx
        .update(tenants)
        .set({ customDomain: data.customDomain || null })
        .where(eq(tenants.id, tenantId))
    }

    const brandingData = { ...brandingValuesOf(data), tenantId }

    const [existingBranding] = await tx
      .select({ tenantId: tenantBranding.tenantId })
      .from(tenantBranding)
      .where(eq(tenantBranding.tenantId, tenantId))
      .limit(1)

    if (existingBranding) {
      await tx.update(tenantBranding).set(brandingData).where(eq(tenantBranding.tenantId, tenantId))
    } else {
      await tx.insert(tenantBranding).values(brandingData)
    }

    return { ok: true as const }
  })
}
