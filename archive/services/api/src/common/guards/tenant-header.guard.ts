import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { REQUIRE_TENANT_KEY } from "../decorators/require-tenant.decorator";
import { env } from "../../env";

@Injectable()
export class TenantHeaderGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requireTenant = this.reflector.getAllAndOverride<boolean>(
      REQUIRE_TENANT_KEY,
      [context.getHandler(), context.getClass()]
    );

    if (!requireTenant || !env.TENANT_HEADER_REQUIRED) return true;

    const request = context.switchToHttp().getRequest<{ headers?: Record<string, string> }>();
    const tenantId =
      request?.headers?.["x-tenant-id"] || request?.headers?.["x-tenant"];

    if (!tenantId) {
      throw new BadRequestException("Missing tenant header");
    }

    return true;
  }
}