import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PERMISSIONS_KEY, RequiredPermission } from "../decorators/permissions.decorator";
import { env } from "../../env";

@Injectable()
export class PermissionsGuard implements CanActivate {
  // Local role-to-permission mapping matching the Casbin policy exactly
  private readonly rolePermissions: Record<string, Record<string, string[]>> = {
    admin: {
      "*": ["*"],
    },
    owner: {
      "*": ["*"],
    },
    scorer: {
      matches: ["read", "write"],
      scoring: ["read", "write"],
      teams: ["read", "write"],
      players: ["read", "write"],
    },
    user: {
      matches: ["read"],
      scoring: ["read"],
      teams: ["read"],
      players: ["read"],
      tournaments: ["read"],
    },
  };

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermission = this.reflector.getAllAndOverride<RequiredPermission>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()]
    );

    if (!requiredPermission) return true;

    if (!env.TRUST_ROLE_HEADER) {
      throw new ForbiddenException("Role claims are not trusted");
    }

    const request = context.switchToHttp().getRequest<{ headers?: Record<string, string> }>();
    const rolesHeader = request?.headers?.["x-user-roles"] || request?.headers?.["x-user-role"] || "user";
    const userRoles = rolesHeader.split(",").map((r) => r.trim());

    const hasPermission = userRoles.some((role) =>
      this.checkRolePermission(role, requiredPermission.resource, requiredPermission.action)
    );

    if (hasPermission) return true;

    throw new ForbiddenException(
      `Insufficient permissions for resource: ${requiredPermission.resource}, action: ${requiredPermission.action}`
    );
  }

  private checkRolePermission(role: string, resource: string, action: string): boolean {
    const permissions = this.rolePermissions[role];
    if (!permissions) return false;

    // Admin/owner super privilege
    if (permissions["*"]?.includes("*")) return true;

    const resourcePermissions = permissions[resource];
    if (!resourcePermissions) return false;

    return resourcePermissions.includes(action) || resourcePermissions.includes("*");
  }
}
