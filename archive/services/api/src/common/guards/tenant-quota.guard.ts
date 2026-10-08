import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { env } from "../../env";
import { getRedisClient } from "../utils/redis-client";
import { tenantQuotaViolationsCounter } from "../utils/metrics";

@Injectable()
export class TenantQuotaGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!env.TENANT_QUOTA_ENABLED) return true;

    const request = context.switchToHttp().getRequest<{ headers?: Record<string, string> }>();
    const tenantId =
      request?.headers?.["x-tenant-id"] || request?.headers?.["x-tenant"];

    if (!tenantId) return true;

    let client;
    try {
      client = getRedisClient();
      if (client.status !== "ready") {
        await client.connect();
      }
    } catch (error) {
      throw new ServiceUnavailableException(
        error?.message || "Redis unavailable for quota enforcement"
      );
    }

    const windowSeconds = env.TENANT_QUOTA_WINDOW_SECONDS;
    const maxRequests = env.TENANT_QUOTA_MAX_REQUESTS;
    const bucket = Math.floor(Date.now() / (windowSeconds * 1000));
    const key = `quota:${tenantId}:${bucket}`;

    const count = await client.incr(key);
    if (count === 1) {
      await client.expire(key, windowSeconds);
    }

    if (count > maxRequests) {
      tenantQuotaViolationsCounter.inc({ tenant: tenantId });
      throw new HttpException("Tenant quota exceeded", HttpStatus.TOO_MANY_REQUESTS);
    }


    return true;
  }
}