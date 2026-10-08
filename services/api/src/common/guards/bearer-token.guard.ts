import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { timingSafeEqual } from "crypto";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";
import { env } from "../../env";

/**
 * Marker stamped on a request once the shared internal token has been verified.
 *
 * `RolesGuard` and `PermissionsGuard` read role claims from the `x-user-roles`
 * header, which the API gateway sets from the authenticated user. That header is
 * only trustworthy if the request genuinely came through the gateway — and the
 * gateway is identified by holding `API_AUTH_TOKEN`.
 *
 * Without this stamp, `x-user-roles: admin` sent straight to the API (bypassing
 * the gateway, which would otherwise overwrite it) satisfied `@Roles("admin")`
 * with no authentication at all, because AUTH_REQUIRED defaulted to false.
 */
export const INTERNAL_AUTH_VERIFIED = Symbol('internalAuthVerified');

export interface InternalAuthRequest {
  headers?: Record<string, string>;
  [INTERNAL_AUTH_VERIFIED]?: boolean;
}

/** True when this request already proved it holds the internal service token. */
export function isInternalAuthVerified(request: unknown): boolean {
  return (
    typeof request === 'object' &&
    request !== null &&
    (request as InternalAuthRequest)[INTERNAL_AUTH_VERIFIED] === true
  );
}

/**
 * Constant-time comparison for the shared token.
 *
 * A plain `!==` leaks the token length and a matching prefix through timing, and
 * the cron route in apps/web already uses `timingSafeEqual` for exactly this
 * kind of secret. Kept consistent deliberately.
 */
function tokensMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

@Injectable()
export class BearerTokenGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<InternalAuthRequest>();

    if (!env.AUTH_REQUIRED) return true;

    if (!env.API_AUTH_TOKEN) {
      throw new UnauthorizedException('Auth token not configured');
    }

    const authHeader = request?.headers?.authorization || '';
    const [scheme, token] = authHeader.split(' ');

    if (scheme !== 'Bearer' || !token || !tokensMatch(token, env.API_AUTH_TOKEN)) {
      throw new UnauthorizedException('Invalid or missing bearer token');
    }

    request[INTERNAL_AUTH_VERIFIED] = true;
    return true;
  }
}