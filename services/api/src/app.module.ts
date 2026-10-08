import { Module, MiddlewareConsumer, NestModule } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_GUARD } from "@nestjs/core";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { APP_FILTER } from "@nestjs/core";
import { ClassSerializerInterceptor } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ThrottlerModule } from "@nestjs/throttler";
import { LoggerModule } from "nestjs-pino";
import { randomUUID } from "crypto";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { TenantsModule } from "./tenants/tenants.module";
import { SslModule } from "./ssl/ssl.module";
import { env } from "./env";
import { RequestIdMiddleware } from "./common/middleware/request-id.middleware";
import { HttpLoggingInterceptor } from "./common/interceptors/http-logging.interceptor";
import { HttpExceptionFilter } from "./common/filters/http-exception.filter";
import { BearerTokenGuard } from "./common/guards/bearer-token.guard";
import { RequestContextInterceptor } from "./common/interceptors/request-context.interceptor";
import { AuditLogInterceptor } from "./common/interceptors/audit-log.interceptor";
import { TenantThrottlerGuard } from "./common/guards/tenant-throttler.guard";
import { RolesGuard } from "./common/guards/roles.guard";
import { PermissionsGuard } from "./common/guards/permissions.guard";
import { TenantHeaderGuard } from "./common/guards/tenant-header.guard";
import { ResponseEnvelopeInterceptor } from "./common/interceptors/response-envelope.interceptor";
import { TenantQuotaGuard } from "./common/guards/tenant-quota.guard";

/**
 * Root application module
 * Modular architecture for multi-tenant cricket platform
 */
@Module({
  imports: [
    // Global configuration
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [".env.local", ".env"],
    }),
    ThrottlerModule.forRoot([
      {
        ttl: env.THROTTLE_TTL,
        limit: env.THROTTLE_LIMIT,
      },
    ]),
    LoggerModule.forRoot({
      pinoHttp: {
        level: env.NODE_ENV === "production" ? "info" : "debug",
        redact: {
          paths: ["req.headers.authorization", "req.headers.cookie"],
          remove: true,
        },
        genReqId: (req) =>
          (req.headers["x-request-id"] as string | undefined) || randomUUID(),
        transport:
          env.NODE_ENV === "production"
            ? undefined
            : {
                target: "pino-pretty",
                options: {
                  colorize: true,
                  translateTime: "SYS:standard",
                  singleLine: true,
                  ignore: "pid,hostname",
                },
              },
      },
    }),
    // Feature modules
    TenantsModule,
    SslModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: TenantThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: BearerTokenGuard,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    {
      provide: APP_GUARD,
      useClass: PermissionsGuard,
    },
    {
      provide: APP_GUARD,
      useClass: TenantHeaderGuard,
    },
    {
      provide: APP_GUARD,
      useClass: TenantQuotaGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: RequestContextInterceptor,
    },

    {
      provide: APP_INTERCEPTOR,
      useClass: AuditLogInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: ResponseEnvelopeInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: HttpLoggingInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useFactory: (reflector: Reflector) => new ClassSerializerInterceptor(reflector),
      inject: [Reflector],
    },
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware).forRoutes("*");
  }
}

