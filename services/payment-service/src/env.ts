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
    PORT: z.coerce.number().int().min(1).max(65535).default(5004),
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    /** Online Stripe/JazzCash/EasyPaisa — off until merchant credentials are live. Manual PK flows stay in Next. */
    ONLINE_PAYMENTS_ENABLED: z
      .enum(["true", "false", "1", "0"])
      .default("false")
      .transform((v) => v === "true" || v === "1"),
    STRIPE_SECRET_KEY: prodRequired("STRIPE_SECRET_KEY"),
    STRIPE_WEBHOOK_SECRET: prodRequired("STRIPE_WEBHOOK_SECRET"),
    JAZZCASH_MERCHANT_ID: prodRequired("JAZZCASH_MERCHANT_ID"),
    JAZZCASH_PASSWORD: prodRequired("JAZZCASH_PASSWORD"),
    JAZZCASH_INTEGRITY_SALT: prodRequired("JAZZCASH_INTEGRITY_SALT"),
    JAZZCASH_BASE_URL: z.string().url().default(
      "https://sandbox.jazzcash.com.pk/CustomerPortal/transactionmanagement/merchantform",
    ),
    JAZZCASH_RETURN_URL: z.string().url().default("https://ssl.mtkcodex.site/payment/callback"),
  })
  .parse(process.env);