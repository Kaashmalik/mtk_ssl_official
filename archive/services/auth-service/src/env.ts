import { z } from "zod";

export const env = z
  .object({
    PORT: z.coerce.number().int().min(1).max(65535).default(5001),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    REDIS_URL: z.string().optional(),
    CLERK_SECRET_KEY: z.string().optional(),
  })
  .parse(process.env);
