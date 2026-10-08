import { z } from "zod";

export const env = z
  .object({
    PORT: z.coerce.number().int().min(1).max(65535).default(5001),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    REDIS_URL: z.string().default("redis://localhost:6379"),
    CLERK_SECRET_KEY: z
      .string()
      .min(1)
      .optional()
      .superRefine((value, ctx) => {
        if ((process.env.NODE_ENV ?? "development") === "production" && !value) {
          ctx.addIssue({ code: "custom", message: "CLERK_SECRET_KEY is required in production" });
        }
      }),
  })
  .parse(process.env);
