import { requirePermissionServer } from "@/lib/rbac-server";
import { Permission } from "@/lib/rbac";

/**
 * Server action guard that checks if the user has the required permission
 * before executing the action.
 */
export function withAuth<Args extends unknown[], Return>(
  permission: Permission,
  handler: (...args: Args) => Promise<Return>
) {
  return async (...args: Args): Promise<Return> => {
    // Automatically enforces authentication and permission checks.
    // Tenant ID is resolved dynamically from headers or the user's session.
    await requirePermissionServer(permission);
    
    return handler(...args);
  };
}
