import { z } from "zod";

export const env = z
  .object({
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    CORS_ORIGINS: z.string().default("*"),
    REDIS_URL: z.string().optional(),
    AUTH_SERVICE_HOST: z.string().default("localhost"),
    AUTH_SERVICE_PORT: z.string().default("5001"),
    TOURNAMENT_SERVICE_HOST: z.string().default("localhost"),
    TOURNAMENT_SERVICE_PORT: z.string().default("5002"),
    SCORING_SERVICE_HOST: z.string().default("localhost"),
    SCORING_SERVICE_PORT: z.string().default("4002"),
  })
  .parse(process.env);
