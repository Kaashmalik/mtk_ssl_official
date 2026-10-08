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
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    KAFKA_BROKERS: z.string().default("localhost:9092"),
    REDIS_URL: z.string().default("redis://localhost:6379"),
    OPENAI_API_KEY: prodRequired("OPENAI_API_KEY"),
    OPENAI_MODEL: z.string().default("gpt-4o"),
    OPENAI_MOCK: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
  })
  .parse(process.env);