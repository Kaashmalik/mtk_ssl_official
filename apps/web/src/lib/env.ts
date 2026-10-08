import { z } from "zod";

/**
 * Runtime feature configuration for apps/web.
 *
 * Unlike the Nest services (which validate env at import and refuse to boot),
 * Next.js builds run WITHOUT runtime secrets, so this module must never throw
 * at import time. It exposes lazy, per-feature readiness checks instead.
 *
 * Features and their required env vars:
 *   paymentsUpload : NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *   email          : SMTP_HOST, SMTP_USER, SMTP_PASS
 *   streaming      : MEDIASOUP_ANNOUNCED_IP, STREAMING_ACCESS_TOKEN
 *   commentary     : OPENAI_API_KEY (or OPENAI_MOCK=true)
 */

export type FeatureName = "paymentsUpload" | "email" | "streaming" | "commentary";

const isDev = (process.env.NODE_ENV ?? "development") !== "production";

const PLACEHOLDER_RE =
  /your_|replace_with|placeholder|changeme|example\.com|get from|<[^>]+>|\[[^\]]+\]/i;

export function isConfigured(value: string | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  if (trimmed.length < 8) return false;
  return !PLACEHOLDER_RE.test(trimmed);
}

function env(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name];
    if (isConfigured(value)) return value;
  }
  return undefined;
}

const FEATURES: Record<FeatureName, { vars: string[]; requires: (v: typeof env) => boolean }> = {
  paymentsUpload: {
    vars: ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"],
    requires: (v) => Boolean(v("NEXT_PUBLIC_SUPABASE_URL") && v("SUPABASE_SERVICE_ROLE_KEY")),
  },
  email: {
    vars: ["SMTP_HOST", "SMTP_USER", "SMTP_PASS"],
    requires: (v) => Boolean(v("SMTP_HOST") && v("SMTP_USER") && v("SMTP_PASS")),
  },
  streaming: {
    vars: ["MEDIASOUP_ANNOUNCED_IP", "STREAMING_ACCESS_TOKEN"],
    requires: (v) => Boolean(v("MEDIASOUP_ANNOUNCED_IP") && v("STREAMING_ACCESS_TOKEN")),
  },
  commentary: {
    vars: ["OPENAI_API_KEY"],
    requires: (v) => v("OPENAI_MOCK") === "true" || Boolean(v("OPENAI_API_KEY")),
  },
};

export interface FeatureReadiness {
  ready: boolean;
  missing: string[];
}

export function featureReadiness(feature: FeatureName): FeatureReadiness {
  const spec = FEATURES[feature];
  const ready = spec.requires(env);
  return {
    ready,
    missing: ready ? [] : spec.vars.filter((name) => !isConfigured(process.env[name])),
  };
}

export function isFeatureReady(feature: FeatureName): boolean {
  return featureReadiness(feature).ready;
}

export class FeatureNotConfiguredError extends Error {
  readonly feature: FeatureName;
  readonly missing: string[];

  constructor(feature: FeatureName, missing: string[]) {
    super(
      `Feature "${feature}" is not configured. Missing or placeholder values: ${missing.join(", ")}. ` +
        `Set these in .env.production (see .env.example) before deploying.`,
    );
    this.name = "FeatureNotConfiguredError";
    this.feature = feature;
    this.missing = missing;
  }
}

export function requireFeature(feature: FeatureName): void {
  const { ready, missing } = featureReadiness(feature);
  if (!ready) throw new FeatureNotConfiguredError(feature, missing);
}

const readinessSchema = z.record(z.enum(["paymentsUpload", "email", "streaming", "commentary"]), z.object({
  ready: z.boolean(),
  missing: z.array(z.string()),
}));

export function allFeatureReadiness() {
  const result = Object.fromEntries(
    (Object.keys(FEATURES) as FeatureName[]).map((name) => [name, featureReadiness(name)]),
  );
  return readinessSchema.parse(result);
}

export const isDevelopment = isDev;
