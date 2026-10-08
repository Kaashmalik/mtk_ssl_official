import { startTracing } from "./common/utils/tracing";
startTracing();

import { env } from "./env";
import * as Sentry from "@sentry/node";

import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { Logger } from "nestjs-pino";
import { closeDbConnection } from "@mtk/database";
import { refreshCorsOrigins } from "./common/cors/tenant-cors";
import { configureApp } from "./app.setup";

/**
 * Bootstrap the NestJS application
 * Multi-tenant API for Shakir Super League
 */
Sentry.init({
  dsn: env.SENTRY_DSN,
  environment:
    process.env.SENTRY_ENVIRONMENT ||
    process.env.APP_ENV ||
    env.NODE_ENV,
  tracesSampleRate:
    (process.env.APP_ENV || env.NODE_ENV) === "production" ? 0.1 : 1.0,
});

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useLogger(app.get(Logger));

  app.enableShutdownHooks();
  configureApp(app);

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

