import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from "@nestjs/common";
import { Observable } from "rxjs";
import { tap } from "rxjs/operators";
import { Request, Response } from "express";
import { RequestWithId } from "../middleware/request-id.middleware";

@Injectable()
export class HttpLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(HttpLoggingInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const httpContext = context.switchToHttp();
    const request = httpContext.getRequest<RequestWithId>();
    const response = httpContext.getResponse<Response>();
    const { method, originalUrl } = request;
    const requestId = request.requestId || "unknown";
    const startTime = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const durationMs = Date.now() - startTime;
          const statusCode = response.statusCode;
          this.logger.log(
            `${method} ${originalUrl} ${statusCode} ${durationMs}ms requestId=${requestId}`
          );
        },
        error: (error) => {
          const durationMs = Date.now() - startTime;
          const statusCode = response.statusCode || 500;
          this.logger.error(
            `${method} ${originalUrl} ${statusCode} ${durationMs}ms requestId=${requestId} error=${error?.message || "unknown"}`
          );
        },
      })
    );
  }
}