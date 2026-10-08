import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { env } from "../../env";
import { Socket } from "socket.io";

@Injectable()
export class BearerTokenWsGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    if (!env.AUTH_REQUIRED) return true;

    if (!env.API_AUTH_TOKEN) {
      throw new UnauthorizedException("Auth token not configured");
    }

    const client = context.switchToWs().getClient<Socket>();
    const authToken =
      (client.handshake.auth?.token as string | undefined) ||
      (client.handshake.headers?.authorization as string | undefined);

    if (!authToken) {
      throw new UnauthorizedException("Missing bearer token");
    }

    if (authToken.startsWith("Bearer ")) {
      const token = authToken.replace("Bearer ", "").trim();
      if (token === env.API_AUTH_TOKEN) return true;
    }

    if (authToken === env.API_AUTH_TOKEN) return true;

    throw new UnauthorizedException("Invalid bearer token");
  }
}