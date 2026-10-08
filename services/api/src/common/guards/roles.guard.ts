import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ROLES_KEY, Role } from "../decorators/roles.decorator";
import { env } from "../../env";
import { isInternalAuthVerified } from "./bearer-token.guard";

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

    const request = context.switchToHttp().getRequest();

    // `x-user-roles` is client-controlled on the wire. The api-gateway
    // overwrites it with the authenticated user's real roles, but that is only
    // meaningful if the request actually passed through the gateway — which is
    // identified by holding API_AUTH_TOKEN (stamped by BearerTokenGuard).
    //
    // Requiring that stamp makes the trust boundary the shared secret rather
    // than network topology, so publishing the API port (or reaching the
    // container network directly) can no longer be escalated into "admin" by
    // simply sending the header.
    if (!isInternalAuthVerified(request)) {
      throw new ForbiddenException(
        "Role claims require a verified internal service token",
      );
    }

    const rolesHeader = request?.headers?.["x-user-roles"] || request?.headers?.["x-user-role"] || "user";
    const userRoles = rolesHeader.split(",").map((r: string) => r.trim());

    const hasRole = userRoles.some((role: string) => requiredRoles.includes(role as Role));
    if (hasRole) return true;

    throw new ForbiddenException("Insufficient role");
  }
}