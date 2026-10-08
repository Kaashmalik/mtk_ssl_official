import { INestApplication, ValidationPipe, VersioningType, VERSION_NEUTRAL } from "@nestjs/common";
import helmet from "helmet";
import express from "express";
import { env } from "./env";
import { isOriginAllowed } from "./common/cors/tenant-cors";

/**
 * Shared Nest application configuration.
 *
 * Used by both the production bootstrap (main.ts) and the e2e suite, so tests
 * exercise exactly the security middleware, validation and route prefixing
 * that ships to production.
 */
export function configureApp(app: INestApplication): void {
  app.use(helmet({ contentSecurityPolicy: false }));
  app.getHttpAdapter().getInstance().disable("x-powered-by");
  app.use(express.json({ limit: env.BODY_MAX_BYTES }));
  app.use(express.urlencoded({ extended: true, limit: env.BODY_MAX_BYTES }));

  app.enableCors({
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      const allowed = isOriginAllowed(origin);
      callback(allowed ? null : new Error("CORS blocked"), allowed);
    },
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      stopAtFirstError: true,
    })
  );

  app.setGlobalPrefix("api");
  // Routes are version-neutral by default: clients that don't send the version
  // header still match, while individual routes can opt in via @Version().
  app.enableVersioning({
    type: VersioningType.HEADER,
    header: "x-api-version",
    defaultVersion: VERSION_NEUTRAL,
  });
}
