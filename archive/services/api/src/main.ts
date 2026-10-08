import { startTracing } from "./common/utils/tracing";
startTracing();

import { env } from "./env";
import * as Sentry from "@sentry/node";

import { NestFactory } from "@nestjs/core";
import { ValidationPipe, VersioningType } from "@nestjs/common";
import helmet from "helmet";
import { AppModule } from "./app.module";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { Logger } from "nestjs-pino";
import { closeDbConnection } from "@mtk/database";
import { isOriginAllowed, refreshCorsOrigins } from "./common/cors/tenant-cors";
import express from "express";

/**
 * Bootstrap the NestJS application
 * Multi-tenant API for Shakir Super League
 */
Sentry.init({
  dsn: env.SENTRY_DSN,
  environment: env.NODE_ENV,
  tracesSampleRate: env.NODE_ENV === "production" ? 0.1 : 1.0,
});

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useLogger(app.get(Logger));

  app.enableShutdownHooks();
  app.use(helmet({ contentSecurityPolicy: false }));
  app.getHttpAdapter().getInstance().disable("x-powered-by");
  app.use(express.json({ limit: env.BODY_MAX_BYTES }));
  app.use(express.urlencoded({ extended: true, limit: env.BODY_MAX_BYTES }));

  // Enable CORS
  app.enableCors({
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
      const allowed = isOriginAllowed(origin);
      callback(allowed ? null : new Error("CORS blocked"), allowed);
    },
    credentials: true,
  });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      stopAtFirstError: true,
    })
  );

  // Global prefix
  app.setGlobalPrefix("api");
  app.enableVersioning({
    type: VersioningType.HEADER,
    header: "x-api-version",
    defaultVersion: "1",
  });

  if (env.NODE_ENV !== "production") {
    const config = new DocumentBuilder()
      .setTitle("SSL API")
      .setDescription("Shakir Super League API")
      .setVersion("2.0.0")
      .addBearerAuth()
      .addApiKey(
        { type: "apiKey", name: "x-api-version", in: "header" },
        "api-version"
      )
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup("api/docs", app, document);
  }

  await app.listen(env.PORT);

  console.log(`🚀 SSL API running on: http://localhost:${env.PORT}/api`);
  console.log(`📡 WebSocket server ready for real-time scoring`);
}

let corsRefreshInterval: NodeJS.Timeout | undefined;

refreshCorsOrigins().catch(() => {
  // ignore boot-time refresh errors
});

corsRefreshInterval = setInterval(() => {
  refreshCorsOrigins().catch(() => {
    // ignore refresh errors; next tick will retry
  });
}, env.CORS_CACHE_SECONDS * 1000);

process.on("SIGTERM", async () => {
  if (corsRefreshInterval) clearInterval(corsRefreshInterval);
  await closeDbConnection();
});

process.on("SIGINT", async () => {
  if (corsRefreshInterval) clearInterval(corsRefreshInterval);
  await closeDbConnection();
});

bootstrap();

