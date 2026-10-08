import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import * as Sentry from "@sentry/node";
import { Request, Response } from "express";
import { resolveErrorCode } from "../errors/error-codes";

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    const requestId = (request.headers["x-request-id"] as string) || "unknown";
    const postgresError = exception as { code?: string; detail?: string };
    
    const mappedStatus = (() => {
      switch (postgresError?.code) {
        case "23505":
          return HttpStatus.CONFLICT;
        case "23503":
          return HttpStatus.BAD_REQUEST;
        case "22P02":
          return HttpStatus.BAD_REQUEST;
        default:
          return undefined;
      }
    })();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : mappedStatus || HttpStatus.INTERNAL_SERVER_ERROR;

    const errorCode = resolveErrorCode(status, postgresError?.code);

    const errorResponse =
      exception instanceof HttpException
        ? exception.getResponse()
        : {
            message:
              mappedStatus === HttpStatus.CONFLICT
                ? "Duplicate resource"
                : mappedStatus === HttpStatus.BAD_REQUEST
                ? "Invalid request"
                : "Internal server error",
          };

    const errorMessage =
      typeof errorResponse === "string"
        ? errorResponse
        : (errorResponse as { message?: string | string[] }).message ||
          "Internal server error";

    const normalizedMessage = Array.isArray(errorMessage)
      ? errorMessage.join(", ")
      : errorMessage;

    if (status >= 500) {
      Sentry.withScope((scope) => {
        scope.setTag("requestId", requestId);
        scope.setTag("method", request.method);
        scope.setTag("url", request.originalUrl || request.url);
        scope.setContext("request", {
          method: request.method,
          url: request.originalUrl || request.url,
          headers: request.headers,
          query: request.query,
          params: request.params,
        });

        Sentry.captureException(exception);
      });
    }

    this.logger.error(
      `Request failed ${request.method} ${request.originalUrl || request.url} ${status} code=${errorCode} requestId=${requestId} message=${normalizedMessage}`
    );

    response.status(status).json({
      statusCode: status,
      errorCode,
      message: normalizedMessage,
      requestId,
      timestamp: new Date().toISOString(),
      path: request.originalUrl || request.url,
    });
  }
}
