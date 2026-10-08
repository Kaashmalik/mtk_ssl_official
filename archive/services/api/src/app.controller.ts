import { Controller, Get, Res, HttpStatus } from "@nestjs/common";
import { SkipThrottle } from "@nestjs/throttler";
import { Public } from "./common/decorators/public.decorator";
import { ApiBadRequestResponse, ApiOkResponse, ApiServiceUnavailableResponse, ApiTags } from "@nestjs/swagger";
import { db } from "@mtk/database";
import { sql } from "drizzle-orm";
import { Response } from "express";
import { retry } from "./common/utils/retry";
import { env } from "./env";
import Redis from "ioredis";
import { ErrorResponseDto } from "./common/dto/error-response.dto";
import { AppService } from "./app.service";
import { registry } from "./common/utils/metrics";

/**
 * Root API controller
 * Health check and basic info endpoints
 */
@ApiTags("system")
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @SkipThrottle()
  @Public()
  @ApiOkResponse({ schema: { type: "string" } })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  getHello(): string {
    return this.appService.getHello();
  }

  @Get("health")
  @SkipThrottle()
  @Public()
  @ApiOkResponse({
    schema: {
      type: "object",
      properties: {
        status: { type: "string" },
        service: { type: "string" },
        version: { type: "string" },
        timestamp: { type: "string", format: "date-time" },
      },
    },
  })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  getHealth(@Res({ passthrough: true }) res: Response) {
    res.setHeader("Cache-Control", `public, max-age=${env.HEALTH_CACHE_SECONDS}`);
    return {
      status: "ok",
      service: "SSL API",
      version: "1.0.0",
      timestamp: new Date().toISOString(),
    };
  }

  @Get("metrics")
  @SkipThrottle()
  @Public()
  @ApiOkResponse({ schema: { type: "string" } })
  async getMetrics(@Res() res: Response) {
    res.set("Content-Type", registry.contentType);
    res.end(await registry.metrics());
  }


  @Get("health/ready")
  @SkipThrottle()
  @Public()
  @ApiOkResponse({
    schema: {
      type: "object",
      properties: {
        status: { type: "string" },
        service: { type: "string" },
        db: { type: "string" },
        redis: { type: "string" },
        timestamp: { type: "string", format: "date-time" },
      },
    },
  })
  @ApiServiceUnavailableResponse({
    schema: {
      type: "object",
      properties: {
        status: { type: "string" },
        service: { type: "string" },
        db: { type: "string" },
        redis: { type: "string" },
        timestamp: { type: "string", format: "date-time" },
      },
    },
  })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  async getReadiness(@Res({ passthrough: true }) res: Response) {
    try {
      res.setHeader("Cache-Control", `public, max-age=${env.HEALTH_CACHE_SECONDS}`);
      const dbCheck = retry(() => db.execute(sql`select 1`), {
        attempts: env.DB_RETRY_ATTEMPTS,
        baseDelayMs: env.DB_RETRY_BASE_DELAY_MS,
      });

      const redisCheck = env.REDIS_URL
        ? (async () => {
            const client = new Redis(env.REDIS_URL as string, {
              lazyConnect: true,
              maxRetriesPerRequest: 0,
              enableReadyCheck: true,
            });
            try {
              await client.connect();
              await client.ping();
              return "up";
            } finally {
              client.disconnect();
            }
          })()
        : Promise.resolve("not_configured");

      const [, redisStatus] = await Promise.all([dbCheck, redisCheck]);
      return {
        status: "ok",
        service: "SSL API",
        db: "up",
        redis: redisStatus,
        timestamp: new Date().toISOString(),
      };
    } catch {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
      return {
        status: "degraded",
        service: "SSL API",
        db: "down",
        redis: env.REDIS_URL ? "down" : "not_configured",
        timestamp: new Date().toISOString(),
      };
    }
  }
}

