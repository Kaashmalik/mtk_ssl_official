import { db, tenants, users, userTenantRoles } from "@mtk/database"
import { and, eq } from "drizzle-orm"
import { getTenantFromRequest } from "./tenant"
import { hasPermission, type UserRole } from "./rbac"

export type DashboardContext = {
  tenantId: string
  tenantName: string
  actorId: string
  role: UserRole
}
export type DashboardAccess =
  | { status: "ready"; context: DashboardContext }
  | { status: "no-tenant" | "denied" | "unavailable" }

/** A host-selected tenant is not proof of membership. Authorize before any metrics. */
export async function getDashboardContext(clerkId: string): Promise<DashboardAccess> {
  try {
    const actor = await db.query.users.findFirst({ where: eq(users.clerkId, clerkId) })
    if (!actor || actor.isActive !== true) return { status: "denied" }
    const requestTenant = await getTenantFromRequest()
    // Same host-first selection as the shared resolver, but do not swallow errors
    // and silently switch workspaces during an outage.
    const tenantId = requestTenant?.id ?? (await (await import("@/app/actions/tenants")).getMyTenant())?.id
    if (!tenantId) return { status: "no-tenant" }
    const membership = await db.query.userTenantRoles.findFirst({ where: and(
      eq(userTenantRoles.userId, actor.id), eq(userTenantRoles.tenantId, tenantId),
    ) })
    // Preserve the existing migration-era fallback only for an absent row, not errors.
    if (membership && (membership.userId !== actor.id || membership.tenantId !== tenantId)) {
      return { status: "denied" }
    }
    const role = membership ? membership.role : (actor.tenantIds.includes(tenantId) ? actor.role : null)
    if (!role || !hasPermission(role, "match:read")) return { status: "denied" }
    const tenant = await db.query.tenants.findFirst({ where: and(eq(tenants.id, tenantId), eq(tenants.isActive, true)) })
    if (!tenant || tenant.id !== tenantId || tenant.isActive !== true) return { status: "denied" }
    return { status: "ready", context: { tenantId, tenantName: tenant.name, actorId: actor.id, role } }
  } catch {
    return { status: "unavailable" }
  }
}
