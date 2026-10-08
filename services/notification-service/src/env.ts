import { z } from "zod";

export const env = z
  .object({
    PORT: z.coerce.number().int().min(1).max(65535).default(4008),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    KAFKA_BROKERS: z.string().default("localhost:9092"),
    FIREBASE_SERVICE_ACCOUNT: z.string().optional(),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(587),
    SMTP_USER: z.string().optional(),
    SMTP_PASS: z.string().optional(),
  })
  .parse(process.env);
