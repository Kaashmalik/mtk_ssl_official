"use server"

import { auth } from "@clerk/nextjs/server"
import { revalidatePath } from "next/cache"
import { db } from "@mtk/database"
import { tenants, tenantBranding, subscriptions, users, userTenantRoles } from "@mtk/database"
import { desc, eq } from "drizzle-orm"
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

  // `tenants.owner_id` is a UUID referencing `users.id`, not Clerk's string ID.
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.clerkId, userId))
    .limit(1)
  if (!user) return null

  const [membership] = await db
    .select({ tenant: tenants })
    .from(userTenantRoles)
    .innerJoin(tenants, eq(userTenantRoles.tenantId, tenants.id))
    .where(eq(userTenantRoles.userId, user.id))
    .orderBy(desc(userTenantRoles.isPrimary), desc(userTenantRoles.createdAt))
    .limit(1)

  if (membership) return membership.tenant

  // Compatibility for older tenant rows whose owner role has not been backfilled.
  const [ownedTenant] = await db
    .select()
    .from(tenants)
    .where(eq(tenants.ownerId, user.id))
    .limit(1)

  return ownedTenant ?? null
}

/**
 * Creates a new tenant (league) with free tier activation.
 *
 * Steps:
 *   1. Insert tenant with plan = 'free', isActive = true.
 *   2. Create an active subscription row for the free plan (amount = 0).
 *   3. Grant the owner role in the tenant-scoped role table.
 */
export async function createTenant(input: CreateTenantInput) {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")

  // Tenant ownership uses the database UUID. Clerk IDs are strings and must not
  // be written into or compared directly with the UUID owner_id column.
  const [dbUser] = await db
    .select({ id: users.id, tenantIds: users.tenantIds })
    .from(users)
    .where(eq(users.clerkId, userId))
    .limit(1)

  if (!dbUser) {
    throw new Error("Your account is still being set up. Please refresh and try again.")
  }

  const existing = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.ownerId, dbUser.id))
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

  // New leagues start on Free. The effective plan and subscription are written
  // together so signup cannot accidentally grant a paid trial or mismatched
  // entitlements.
  const now = new Date()
  const periodEnd = new Date(now)
  periodEnd.setMonth(periodEnd.getMonth() + 1)

  const tenant = await db.transaction(async (tx) => {
    const [createdTenant] = await tx
      .insert(tenants)
      .values({
        name: parsed.name,
        slug: parsed.slug,
        customDomain: null,
        ownerId: dbUser.id,
        plan: "free",
        isActive: true,
      })
      .returning()

    await tx.insert(subscriptions).values({
      tenantId: createdTenant.id,
      plan: "free",
      status: "active",
      monthlyAmount: "0",
      currency: "PKR",
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
    })

    await tx.insert(userTenantRoles).values({
      userId: dbUser.id,
      tenantId: createdTenant.id,
      role: "league_owner",
      isPrimary: true,
    }).onConflictDoNothing({
      target: [userTenantRoles.userId, userTenantRoles.tenantId],
    })

    // Keep the legacy membership array synchronized until all consumers have
    // moved to user_tenant_roles. Do not set the user's global role here.
    await tx
      .update(users)
      .set({
        tenantIds: [...(Array.isArray(dbUser.tenantIds) ? dbUser.tenantIds : []), createdTenant.id],
        updatedAt: now,
      })
      .where(eq(users.id, dbUser.id))

    return createdTenant
  })

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
