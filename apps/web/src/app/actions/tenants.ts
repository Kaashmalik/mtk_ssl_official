"use server"

import { auth } from "@clerk/nextjs/server"
import { revalidatePath } from "next/cache"
import { db } from "@mtk/database"
import { tenants, tenantBranding, subscriptions, users } from "@mtk/database"
import { eq } from "drizzle-orm"
import { z } from "zod"
import { withAuth } from "./action-guard"


const createTenantSchema = z.object({
  name: z.string().min(2, "League name must be at least 2 characters").max(120),
  slug: z
    .string()
    .min(2, "Slug must be at least 2 characters")
    .max(60, "Slug must be 60 characters or fewer")
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers, and hyphens only"),
})

export type CreateTenantInput = z.infer<typeof createTenantSchema>

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}

export async function getMyTenant() {
  const { userId } = await auth()
  if (!userId) return null

  const [tenant] = await db
    .select()
    .from(tenants)
    .where(eq(tenants.ownerId, userId))
    .limit(1)

  return tenant ?? null
}

/**
 * Creates a new tenant (league) with free tier activation.
 *
 * Steps:
 *   1. Insert tenant with plan = 'free', isActive = true.
 *   2. Create an active subscription row for the free plan (amount = 0).
 *   3. Link the Clerk user to the tenant via users.tenant_ids array.
 *      This ensures the webhook-synced user record has the tenant reference.
 */
export async function createTenant(input: CreateTenantInput) {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")

  const existing = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.ownerId, userId))
    .limit(1)

  if (existing.length > 0) {
    throw new Error("You already have a league. Contact support to create another.")
  }

  const parsed = createTenantSchema.parse({
    ...input,
    slug: input.slug ? input.slug : generateSlug(input.name),
  })

  const [slugTaken] = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.slug, parsed.slug))
    .limit(1)

  if (slugTaken) {
    throw new Error("This league URL is already taken. Please choose another.")
  }

  // 1. Create tenant.
  //
  // `plan` records the tenant's *effective entitlement*, and every limit is
  // enforced from it (teams/players quota, live streaming, white-label — see
  // `getPlanLimits` call sites). It was previously hardcoded to "free" while the
  // subscription row below was created as a 14-day **Pro** trial, so the trial was
  // sold but never honoured: a new league sat on free limits (4 teams, 40
  // players, no streaming) for the whole 14 days, and the two records disagreed.
  //
  // Set to "pro" to match the trialing subscription. Trial expiry is already
  // handled by `/api/cron/subscription-renewal`, which selects `trialing` rows
  // past `currentPeriodEnd` and downgrades `tenants.plan` to "free" in the same
  // transaction as pausing the subscription — so this cannot leak paid features.
  //
  // NOTE: `tenants.plan` and `subscriptions.plan` are two sources of truth that
  // must be written together. Divergent drift is the root cause of this bug; see
  // the "Dual source of truth for plan" note in PLAN_ENHANCED_2026-10-04.md.
  const now = new Date()
  const periodEnd = new Date(now)
  periodEnd.setMonth(periodEnd.getMonth() + 1)

  const [tenant] = await db
    .insert(tenants)
    .values({
      name: parsed.name,
      slug: parsed.slug,
      customDomain: null,
      ownerId: userId,
      plan: "pro",
      isActive: true,
    })
    .returning()

  // 2. Create subscription row — start on a 14-day Pro trial
  const trialEnd = new Date(now)
  trialEnd.setDate(trialEnd.getDate() + 14)
  await db.insert(subscriptions).values({
    tenantId: tenant.id,
    plan: "pro",
    status: "trialing",
    monthlyAmount: "14999",
    currency: "PKR",
    currentPeriodStart: now,
    currentPeriodEnd: trialEnd,
    trialEndsAt: trialEnd,
  })

  // 3. Link the user to this tenant via tenant_ids array
  //    Find the user by clerkId (set by the Clerk webhook)
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.clerkId, userId))
    .limit(1)

  if (user) {
    const currentTenantIds: string[] = Array.isArray(user.tenantIds) ? user.tenantIds : []
    if (!currentTenantIds.includes(tenant.id)) {
      await db
        .update(users)
        .set({
          tenantIds: [...currentTenantIds, tenant.id],
          role: "league_owner",
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id))
    }
  }

  revalidatePath("/dashboard")
  revalidatePath("/dashboard/league")

  return { success: true, tenant }
}

const updateBrandingSchema = z.object({
  name: z.string().min(2, "League name must be at least 2 characters").max(120),
  appName: z.string().optional().nullable(),
  logoUrl: z.string().url().optional().nullable().or(z.literal("")),
  faviconUrl: z.string().url().optional().nullable().or(z.literal("")),
  primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Invalid hex color").optional().nullable(),
  secondaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Invalid hex color").optional().nullable(),
  accentColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Invalid hex color").optional().nullable(),
})

export type UpdateBrandingInput = z.infer<typeof updateBrandingSchema>

export const updateTenantBrandingSettings = withAuth("settings:manage", async (input: UpdateBrandingInput) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  const tenant = await getMyTenant()
  if (!tenant) throw new Error("Tenant not found")

  const validated = updateBrandingSchema.parse(input)

  // Update tenant name
  await db.update(tenants)
    .set({ name: validated.name, updatedAt: new Date() })
    .where(eq(tenants.id, tenant.id))

  // Upsert tenant branding
  const brandingData = {
    tenantId: tenant.id,
    appName: validated.appName || validated.name,
    logoUrl: validated.logoUrl || null,
    faviconUrl: validated.faviconUrl || null,
    primaryColor: validated.primaryColor || null,
    secondaryColor: validated.secondaryColor || null,
    accentColor: validated.accentColor || null,
    updatedAt: new Date()
  }

  const [existingBranding] = await db.select().from(tenantBranding).where(eq(tenantBranding.tenantId, tenant.id)).limit(1)
  if (existingBranding) {
    await db.update(tenantBranding).set(brandingData).where(eq(tenantBranding.tenantId, tenant.id))
  } else {
    await db.insert(tenantBranding).values({
      ...brandingData,
      createdAt: new Date()
    })
  }

  revalidatePath("/dashboard/settings")
  revalidatePath("/dashboard")
  return { success: true }
})
