import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { Observable } from "rxjs";
import { runWithRequestContext } from "../context/request-context";
import { RequestWithId } from "../middleware/request-id.middleware";

@Injectable()
export class RequestContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const httpContext = context.switchToHttp();
    const request = httpContext.getRequest<RequestWithId>();
    const requestId = request?.requestId || request?.header?.("x-request-id");

    return runWithRequestContext({ requestId }, () => next.handle());
  }
}