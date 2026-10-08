import { z } from "zod";

const defaultCorsOrigins = [
  "http://localhost:3000",
  "http://localhost:3001",
  "http://localhost:3002",
  "https://ssl.mtkcodex.site",
  "https://admin.ssl.mtkcodex.site",
];

export const env = z
  .object({
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    DATABASE_URL: z.string().optional(),
    REDIS_URL: z.string().optional(),
    KAFKA_BROKERS: z.string().optional(),
    CORS_ORIGINS: z.string().optional(),
    CORS_CACHE_SECONDS: z.coerce.number().int().min(60).max(3600).default(300),
    CORS_ALLOW_SUBDOMAIN: z.coerce.boolean().default(true),
    THROTTLE_TTL: z.coerce.number().int().min(1).max(3600).default(60),
    THROTTLE_LIMIT: z.coerce.number().int().min(1).max(10000).default(120),
    SENTRY_DSN: z.string().optional(),
    LOG_BODY: z.coerce.boolean().default(false),
    LOG_BODY_MAX_BYTES: z.coerce.number().int().min(256).max(1048576).default(8192),
    AUTH_REQUIRED: z.coerce.boolean().default(false),
    API_AUTH_TOKEN: z.string().optional(),
    WS_LOG_PAYLOAD: z.coerce.boolean().default(false),
    WS_LOG_MAX_BYTES: z.coerce.number().int().min(256).max(1048576).default(4096),
    WS_MAX_PAYLOAD_BYTES: z.coerce.number().int().min(1024).max(10485760).default(1048576),
    DB_RETRY_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
    DB_RETRY_BASE_DELAY_MS: z.coerce.number().int().min(50).max(5000).default(150),
    HEALTH_CACHE_SECONDS: z.coerce.number().int().min(0).max(300).default(5),
    AUDIT_LOG_ENABLED: z.coerce.boolean().default(true),
    TRUST_ROLE_HEADER: z.coerce.boolean().default(false),
    BODY_MAX_BYTES: z.coerce.number().int().min(1024).max(10485760).default(1048576),
    TENANT_HEADER_REQUIRED: z.coerce.boolean().default(false),
    ROLE_THROTTLE_ADMIN: z.coerce.number().int().min(1).max(10000).default(500),
    ROLE_THROTTLE_SCORER: z.coerce.number().int().min(1).max(10000).default(200),
    ROLE_THROTTLE_USER: z.coerce.number().int().min(1).max(10000).default(120),
    RESPONSE_WRAP_ENABLED: z.coerce.boolean().default(false),
    TENANT_QUOTA_ENABLED: z.coerce.boolean().default(false),
    TENANT_QUOTA_MAX_REQUESTS: z.coerce.number().int().min(1).max(100000).default(1000),
    TENANT_QUOTA_WINDOW_SECONDS: z.coerce.number().int().min(10).max(3600).default(60),
  })
  .parse(process.env);

export const corsOrigins = (() => {
  if (!env.CORS_ORIGINS) return defaultCorsOrigins;

  const origins = env.CORS_ORIGINS.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  return origins.length > 0 ? origins : defaultCorsOrigins;
})();
