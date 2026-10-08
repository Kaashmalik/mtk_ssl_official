import { Injectable } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import { Reflector } from "@nestjs/core";
import { ROLE_THROTTLE_KEY, RoleThrottleConfig } from "../decorators/role-throttle.decorator";
import { env } from "../../env";

@Injectable()
export class TenantThrottlerGuard extends ThrottlerGuard {
  constructor(
    options: any,
    storageService: any,
    reflector: Reflector
  ) {
    super(options, storageService, reflector);
  }

  protected async getLimit(context: any, limit: number): Promise<number> {
    const request = context.switchToHttp().getRequest();
    const roleHeader = request?.headers?.["x-user-role"] || "user";

    const roleConfig = this.reflector.getAllAndOverride<RoleThrottleConfig>(ROLE_THROTTLE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const fallback = {
      admin: env.ROLE_THROTTLE_ADMIN,
      owner: env.ROLE_THROTTLE_ADMIN,
      scorer: env.ROLE_THROTTLE_SCORER,
      user: env.ROLE_THROTTLE_USER,
    };

    const configured = roleConfig || fallback;
    const limitByRole = configured[roleHeader as keyof RoleThrottleConfig];

    return limitByRole || limit;
  }
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const tenantId =
      (req.headers?.["x-tenant-id"] as string | undefined)?.trim() ||
      (req.headers?.["x-tenant"] as string | undefined)?.trim();

    const ip =
      req.ip ||
      req.headers?.["x-forwarded-for"] ||
      req.connection?.remoteAddress ||
      "unknown";

    if (tenantId) {
      return `${tenantId}:${ip}`;
    }

    return typeof ip === "string" ? ip : JSON.stringify(ip);
  }
}