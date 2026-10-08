import { z } from "zod";

export const env = z
  .object({
    PORT: z.coerce.number().int().min(1).max(65535).default(5002),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    KAFKA_BROKERS: z.string().default("localhost:9092"),
    DATABASE_URL: z.string().optional(),
  })
  .parse(process.env);
