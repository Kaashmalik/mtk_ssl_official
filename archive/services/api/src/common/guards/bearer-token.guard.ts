import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";
import { env } from "../../env";

@Injectable()
export class BearerTokenGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) return true;
    if (!env.AUTH_REQUIRED) return true;

    if (!env.API_AUTH_TOKEN) {
      throw new UnauthorizedException("Auth token not configured");
    }

    const request = context.switchToHttp().getRequest<{ headers?: Record<string, string> }>();
    const authHeader = request?.headers?.authorization || "";
    const [scheme, token] = authHeader.split(" ");

    if (scheme !== "Bearer" || token !== env.API_AUTH_TOKEN) {
      throw new UnauthorizedException("Invalid or missing bearer token");
    }

    return true;
  }
}