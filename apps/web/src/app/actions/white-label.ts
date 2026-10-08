"use server"

import { auth } from "@clerk/nextjs/server"
import { db, users, whiteLabelRequests, getPlanLimits, withTenantContext, withoutTenantContext, type PlanKey } from "@mtk/database"
import { and, desc, eq } from "drizzle-orm"
import { z } from "zod"
import { getMyTenant } from "@/app/actions/tenants"
import { withAuth } from "./action-guard"

const requestSchema = z.object({
  customDomain: z.string().trim().max(253).optional().nullable(),
  hideBranding: z.boolean().default(false),
  customAppName: z.string().trim().min(2).max(120).optional().nullable(),
  reason: z.string().trim().max(500).optional().nullable(),
})

function normalizeDomain(value: string): string {
  const domain = value.toLowerCase().replace(/\.$/, "")
  if (
    domain.length > 253 ||
    !domain.includes(".") ||
    domain.includes("..") ||
    !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)
  ) {
    throw new Error("Enter a valid domain name without a URL, path, or port")
  }
  return domain
}

export const requestWhiteLabel = withAuth("settings:manage", async (input: z.infer<typeof requestSchema>) => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  const tenant = await getMyTenant()
  if (!tenant) throw new Error("League not found")

  const validated = requestSchema.parse(input)
  const limits = getPlanLimits(tenant.plan as PlanKey)
  if ((validated.hideBranding || validated.customAppName) && !limits.whiteLabel) {
    throw new Error("White-label branding requires the Pro plan or above. Upgrade before submitting this request.")
  }
  if (validated.customDomain && !limits.customDomain) {
    throw new Error("Custom domains require Enterprise. Upgrade before submitting a domain request.")
  }
  if (!validated.hideBranding && !validated.customAppName && !validated.customDomain) {
    throw new Error("Choose at least one white-label feature to request")
  }

  const [actor] = await withoutTenantContext(() => db.select({ id: users.id }).from(users)
    .where(eq(users.clerkId, userId)).limit(1))
  if (!actor) throw new Error("Your account is still provisioning. Please try again.")

  return withTenantContext({ userId, tenantId: tenant.id }, async () => {
    const [pending] = await db.select({ id: whiteLabelRequests.id }).from(whiteLabelRequests)
      .where(and(
        eq(whiteLabelRequests.tenantId, tenant.id),
        eq(whiteLabelRequests.status, "pending"),
      )).limit(1)
    if (pending) throw new Error("Your league already has a white-label request awaiting review")

    const [created] = await db.insert(whiteLabelRequests).values({
      tenantId: tenant.id,
      requestedBy: actor.id,
      status: "pending",
      customDomain: validated.customDomain ? normalizeDomain(validated.customDomain) : null,
      hideBranding: validated.hideBranding,
      customAppName: validated.customAppName || null,
      reason: validated.reason || null,
    }).returning({ id: whiteLabelRequests.id, status: whiteLabelRequests.status })

    return { success: true, request: created }
  })
})

export const getMyWhiteLabelRequests = withAuth("settings:manage", async () => {
  const { userId } = await auth()
  if (!userId) throw new Error("Unauthorized")
  const tenant = await getMyTenant()
  if (!tenant) return []
  return withTenantContext({ userId, tenantId: tenant.id }, () => db.select({
      id: whiteLabelRequests.id,
      status: whiteLabelRequests.status,
      customDomain: whiteLabelRequests.customDomain,
      hideBranding: whiteLabelRequests.hideBranding,
      customAppName: whiteLabelRequests.customAppName,
      adminNotes: whiteLabelRequests.adminNotes,
      createdAt: whiteLabelRequests.createdAt,
    }).from(whiteLabelRequests)
      .where(eq(whiteLabelRequests.tenantId, tenant.id))
      .orderBy(desc(whiteLabelRequests.createdAt))
      .limit(10))
})
