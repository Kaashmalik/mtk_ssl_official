import { db, getPlanLimits, tenantBranding, tenants } from "@mtk/database"
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

    const brandingData = {
      tenantId,
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
    }

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
