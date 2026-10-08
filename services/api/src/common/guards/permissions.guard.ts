import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PERMISSIONS_KEY, RequiredPermission } from "../decorators/permissions.decorator";
import { env } from "../../env";
import { isInternalAuthVerified, InternalAuthRequest } from "./bearer-token.guard";

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

    const request = context.switchToHttp().getRequest<InternalAuthRequest>();

    // Same trust boundary as RolesGuard: `x-user-roles` is client-controlled on
    // the wire and is only meaningful when it was set by the api-gateway, which
    // is identified by holding the internal service token (stamped by
    // BearerTokenGuard). Without this, a direct caller could assert admin.
    if (!isInternalAuthVerified(request)) {
      throw new ForbiddenException(
        "Role claims require a verified internal service token"
      );
    }

    const rolesHeader: string =
      request?.headers?.["x-user-roles"] || request?.headers?.["x-user-role"] || "user";
    const userRoles: string[] = rolesHeader.split(",").map((r) => r.trim());

    const hasPermission = userRoles.some((role: string) =>
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
