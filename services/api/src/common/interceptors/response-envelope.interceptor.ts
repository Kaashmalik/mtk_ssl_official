import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { map, Observable } from "rxjs";
import { RAW_RESPONSE_KEY } from "../decorators/raw-response.decorator";
import { env } from "../../env";
import { getRequestId } from "../context/request-context";

@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!env.RESPONSE_WRAP_ENABLED) {
      return next.handle();
    }

    const raw = this.reflector.getAllAndOverride<boolean>(RAW_RESPONSE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (raw) return next.handle();

    return next.handle().pipe(
      map((data) => ({
        status: "success",
        requestId: getRequestId(),
        data,
      }))
    );
  }
}