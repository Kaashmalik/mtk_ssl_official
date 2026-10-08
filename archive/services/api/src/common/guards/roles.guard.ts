import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ROLES_KEY, Role } from "../decorators/roles.decorator";
import { env } from "../../env";

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) return true;

    if (!env.TRUST_ROLE_HEADER) {
      throw new ForbiddenException("Role claims are not trusted");
    }

    const request = context.switchToHttp().getRequest<{ headers?: Record<string, string> }>();
    
    // Support both plural x-user-roles (comma-separated from gateway) and singular x-user-role
    const rolesHeader = request?.headers?.["x-user-roles"] || request?.headers?.["x-user-role"] || "user";
    const userRoles = rolesHeader.split(",").map(r => r.trim());

    const hasRole = userRoles.some(role => requiredRoles.includes(role as Role));
    if (hasRole) return true;

    throw new ForbiddenException("Insufficient role");
  }
}