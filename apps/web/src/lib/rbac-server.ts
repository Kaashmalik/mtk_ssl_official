import { auth } from "@clerk/nextjs/server";
import { db, users, userTenantRoles, tenants, membershipGrantsAccess } from "@mtk/database";
import { isPlatformRole } from "@mtk/database/lib/resource-grants";
import { eq, and } from "drizzle-orm";
import { Permission, UserRole, hasPermission } from "./rbac";
import { getTenantFromRequest } from "./tenant";

/**
 * Resolve active tenant ID from request subdomain or user ownership
 */
export async function resolveActiveTenantId(): Promise<string | null> {
  // Resolution failure must not silently switch to another workspace.
  const requestTenant = await getTenantFromRequest(true);
  if (requestTenant) return requestTenant.id;
  const { getMyTenant } = await import("@/app/actions/tenants");
  return (await getMyTenant())?.id ?? null;
}

/**
 * Get user role for a specific tenant from the junction table.
 * Explicit active membership only. Missing rows and lookup failures never grant
 * legacy/global privileges; deploy the membership backfill before this code.
 */
export async function getUserRoleForTenant(
  clerkUserId: string,
  tenantId: string
): Promise<UserRole | null> {
  const user = await db.query.users.findFirst({ where: eq(users.clerkId, clerkUserId) });
  if (!user || user.isActive !== true) return null;
  const membership = await db.query.userTenantRoles.findFirst({ where: and(
    eq(userTenantRoles.userId, user.id), eq(userTenantRoles.tenantId, tenantId),
  ) });
  if (!membership || membership.userId !== user.id || membership.tenantId !== tenantId
    || !membershipGrantsAccess(membership) || isPlatformRole(membership.role)) return null;
  const tenant = await db.query.tenants.findFirst({ where: and(eq(tenants.id, tenantId), eq(tenants.isActive, true)) });
  if (!tenant || tenant.id !== tenantId || tenant.isActive !== true) return null;
  return membership.role as UserRole;
}

export async function hasPermissionServer(permission: Permission, tenantId?: string): Promise<boolean> {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) return false;

  try {
    // Invitation acceptance bootstraps membership, not league administration.
    if (permission === "invite:accept") {
      const user = await db.query.users.findFirst({ where: eq(users.clerkId, clerkUserId) });
      return user?.isActive === true;
    }
    const targetTenantId = tenantId ?? (await resolveActiveTenantId());
    if (!targetTenantId) return false;
    const role = await getUserRoleForTenant(clerkUserId, targetTenantId);
    return role !== null && hasPermission(role, permission);
  } catch {
    return false;
  }
}

/**
 * Enforce that the current Clerk user has a specific permission.
 * Throws an error if they do not.
 */
export async function requirePermissionServer(permission: Permission, tenantId?: string): Promise<void> {
  const hasPerm = await hasPermissionServer(permission, tenantId);
  if (!hasPerm) {
    throw new Error(`Forbidden: Missing required permission ${permission}`);
  }
}
