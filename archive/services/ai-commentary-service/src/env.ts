import { z } from "zod";

export const env = z
  .object({
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    KAFKA_BROKERS: z.string().default("localhost:9092"),
    OPENAI_API_KEY: z.string().optional(),
  })
  .parse(process.env);
