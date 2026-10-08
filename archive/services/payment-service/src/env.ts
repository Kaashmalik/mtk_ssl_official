import { z } from "zod";

export const env = z
  .object({
    PORT: z.coerce.number().int().min(1).max(65535).default(5004),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    STRIPE_SECRET_KEY: z.string().optional(),
    JAZZCASH_MERCHANT_ID: z.string().optional(),
    JAZZCASH_PASSWORD: z.string().optional(),
  })
  .parse(process.env);
