import { auth } from "@clerk/nextjs/server";
import { db, users, userTenantRoles } from "@mtk/database";
import { eq, and } from "drizzle-orm";
import { Permission, UserRole, hasPermission } from "./rbac";
import { getTenantFromRequest } from "./tenant";

/**
 * Resolve active tenant ID from request subdomain or user ownership
 */
export async function resolveActiveTenantId(): Promise<string | null> {
  // 1. Try request headers (subdomain)
  try {
    const requestTenant = await getTenantFromRequest();
    if (requestTenant) return requestTenant.id;
  } catch {
    // ignore
  }

  // 2. Try user owned tenant
  try {
    const { getMyTenant } = await import("@/app/actions/tenants");
    const ownedTenant = await getMyTenant();
    if (ownedTenant) return ownedTenant.id;
  } catch {
    // ignore
  }

  return null;
}

/**
 * Get user role for a specific tenant from the junction table.
 * Falls back to the legacy users.role column if no junction row exists.
 */
export async function getUserRoleForTenant(
  clerkUserId: string,
  tenantId: string
): Promise<UserRole | null> {
  // 1. Try new user_tenant_roles junction table first
  try {
    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.clerkId, clerkUserId))
      .limit(1);

    if (!user) return null;

    const [roleRow] = await db
      .select({ role: userTenantRoles.role })
      .from(userTenantRoles)
      .where(
        and(
          eq(userTenantRoles.userId, user.id),
          eq(userTenantRoles.tenantId, tenantId)
        )
      )
      .limit(1);

    if (roleRow) return roleRow.role as UserRole;
  } catch {
    // Junction table may not exist yet — fall through to legacy
  }

  // 2. Fall back to legacy users.role + tenantIds
  const legacyResult = await getUserRoleAndTenantIds(clerkUserId);
  if (!legacyResult) return null;
  if (legacyResult.tenantIds.includes(tenantId)) return legacyResult.role;

  return null;
}

/**
 * Get user role and tenant IDs by clerk ID (legacy — reads from users table).
 * Kept for backward compatibility during migration.
 */
export async function getUserRoleAndTenantIds(clerkUserId: string) {
  const user = await db.query.users.findFirst({
    where: eq(users.clerkId, clerkUserId),
  });
  
  if (!user) return null;
  
  return {
    role: user.role as UserRole,
    tenantIds: (user.tenantIds || []) as string[],
  };
}

export async function hasPermissionServer(permission: Permission, tenantId?: string): Promise<boolean> {
  const { userId: clerkUserId } = await auth();
  if (!clerkUserId) return false;

  // Resolve tenant ID if not specified
  const targetTenantId = tenantId || (await resolveActiveTenantId());

  // Try junction-table-aware role lookup first
  if (targetTenantId) {
    const tenantRole = await getUserRoleForTenant(clerkUserId, targetTenantId);
    if (tenantRole === "super_admin") return true;
    if (tenantRole) return hasPermission(tenantRole, permission);
  }

  // Fall back to legacy path
  const userRecord = await getUserRoleAndTenantIds(clerkUserId);
  if (!userRecord) return false;

  const { role, tenantIds } = userRecord;

  // Super admin has all permissions
  if (role === "super_admin") return true;

  // If a tenantId is specified or resolved, user must belong to that tenant
  if (targetTenantId && !tenantIds.includes(targetTenantId)) {
    return false;
  }

  return hasPermission(role, permission);
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
