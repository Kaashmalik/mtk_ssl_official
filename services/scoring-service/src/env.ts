import { z } from "zod";

const prodRequired = (name: string) =>
  z
    .string()
    .min(1)
    .optional()
    .superRefine((value, ctx) => {
      if ((process.env.NODE_ENV ?? "development") === "production" && !value) {
        ctx.addIssue({ code: "custom", message: `${name} is required in production` });
      }
    });

export const env = z
  .object({
    PORT: z.coerce.number().int().min(1).max(65535).default(4002),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    CORS_ORIGINS: z.string().default("http://localhost:3000,http://localhost:3001"),
    // REDIS_URL is the canonical connection string (redis://host:port).
    // REDIS_HOST/REDIS_PORT are kept only as per-host overrides.
    REDIS_URL: z.string().default("redis://localhost:6379"),
    REDIS_HOST: z.string().optional(),
    REDIS_PORT: z.coerce.number().int().min(1).max(65535).optional(),
    KAFKA_BROKERS: z.string().default("localhost:9092"),
    DATABASE_URL: prodRequired("DATABASE_URL"),
    SCORING_GATEWAY_TOKEN: prodRequired("SCORING_GATEWAY_TOKEN"),
  })
  .parse(process.env);

/**
 * Explicit origin allowlist for HTTP + Socket.IO CORS.
 * A wildcard is never honoured in production: an empty allowlist denies CORS
 * there, while development keeps permissive defaults for local work.
 */
export function corsAllowlist(): string[] | boolean {
  const allowlist = env.CORS_ORIGINS.split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0 && origin !== "*");

  if (allowlist.length > 0) return allowlist;
  return env.NODE_ENV === "production" ? false : true;
}