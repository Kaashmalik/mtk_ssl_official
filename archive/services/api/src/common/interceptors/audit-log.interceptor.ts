import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from "@nestjs/common";
import { Observable } from "rxjs";
import { tap } from "rxjs/operators";
import { RequestWithId } from "../middleware/request-id.middleware";
import { env } from "../../env";
import { redactSensitiveData, safeSerialize } from "../utils/redact";
import { db, auditLogs } from "@mtk/database";

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  private readonly logger = new Logger("AuditLog");

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!env.AUDIT_LOG_ENABLED) return next.handle();

    const httpContext = context.switchToHttp();
    const request = httpContext.getRequest<RequestWithId>();

    if (!request || !WRITE_METHODS.has(request.method)) {
      return next.handle();
    }

    const requestId = request.requestId || "unknown";
    const path = request.originalUrl || request.url;
    const redactedBody = redactSensitiveData(request.body);
    const serializedBody = safeSerialize(redactedBody, env.LOG_BODY_MAX_BYTES);

    return next.handle().pipe(
      tap({
        next: async () => {
          this.logger.log(
            `${request.method} ${path} requestId=${requestId} body=${serializedBody}`
          );

          try {
            await db.insert(auditLogs).values({
              requestId,
              tenantId: (request.headers?.["x-tenant-id"] as string | undefined) || null,
              actorId: (request.headers?.["x-user-id"] as string | undefined) || null,
              actorRole: (request.headers?.["x-user-role"] as string | undefined) || null,
              method: request.method,
              path,
              ip: request.ip,
              userAgent: request.headers?.["user-agent"] as string | undefined,
              payload: JSON.parse(serializedBody === "[Unserializable]" ? "null" : serializedBody),
              statusCode: "200",
            });
          } catch (error) {
            this.logger.error(`Audit log insert failed: ${error?.message || "unknown"}`);
          }
        },
        error: async (error) => {
          this.logger.error(
            `${request.method} ${path} requestId=${requestId} body=${serializedBody} error=${error?.message || "unknown"}`
          );

          try {
            await db.insert(auditLogs).values({
              requestId,
              tenantId: (request.headers?.["x-tenant-id"] as string | undefined) || null,
              actorId: (request.headers?.["x-user-id"] as string | undefined) || null,
              actorRole: (request.headers?.["x-user-role"] as string | undefined) || null,
              method: request.method,
              path,
              ip: request.ip,
              userAgent: request.headers?.["user-agent"] as string | undefined,
              payload: JSON.parse(serializedBody === "[Unserializable]" ? "null" : serializedBody),
              statusCode: "500",
            });
          } catch (auditError) {
            this.logger.error(`Audit log insert failed: ${auditError?.message || "unknown"}`);
          }
        },
      })
    );
  }
}