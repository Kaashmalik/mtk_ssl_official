/* eslint-disable @typescript-eslint/no-require-imports -- Next.js config is CommonJS; Sentry wrap needs require() */
const path = require("path");
const fs = require("fs");

/**
 * Monorepo: Next only auto-loads env from apps/web. Pull root env so local
 * builds see Clerk/Supabase keys without duplicating files per app.
 */
function loadRootEnv() {
  const root = path.join(__dirname, "../..");
  const files = [".env", ".env.local"];
  if (process.env.NODE_ENV === "production") {
    files.push(".env.production", ".env.production.local");
  } else {
    files.push(".env.development", ".env.development.local");
  }

  const isPlaceholder = (val) =>
    /your_|replace_with|placeholder|changeme|example\.com|get from|\[[^\]]+\]/i.test(
      val,
    ) || val.length < 20;

  for (const name of files) {
    const filePath = path.join(root, name);
    if (!fs.existsSync(filePath)) continue;
    for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (!val || isPlaceholder(val)) continue;
      process.env[key] = val;
    }
  }
}

loadRootEnv();

const { z } = require("zod");

z.object({
  NEXT_PUBLIC_API_URL: z.string().url().default("http://localhost:4000"),
  NEXT_PUBLIC_WS_URL: z.string().url().default("http://localhost:4000"),
}).parse(process.env);

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@mtk/ui", "@mtk/database"],
  eslint: {
    ignoreDuringBuilds: false,
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  // Ensure client bundle receives public keys loaded from monorepo root
  env: {
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: (() => {
      const key = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || "";
      if (
        !key ||
        /\[[^\]]+\]/.test(key) ||
        /your_|get from|placeholder|replace_with/i.test(key) ||
        key.length < 40
      ) {
        return "";
      }
      return key;
    })(),
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000",
    NEXT_PUBLIC_WS_URL: process.env.NEXT_PUBLIC_WS_URL || "http://localhost:4000",
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.supabase.co",
      },
      {
        protocol: "https",
        hostname: "**.clerk.dev",
      },
      {
        protocol: "https",
        hostname: "img.clerk.com",
      },
    ],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=()" },
        ],
      },
    ];
  },
};

// Sentry webpack plugin calls sentry-cli during build. Only enable when
// CI or SENTRY_UPLOAD=1 — a present-but-wrong token must not break builds.
const isDev = process.env.NODE_ENV !== "production";
const sentryEnabled =
  Boolean(process.env.SENTRY_AUTH_TOKEN) &&
  (process.env.CI === "true" || process.env.SENTRY_UPLOAD === "1");

if (isDev || !sentryEnabled) {
  module.exports = nextConfig;
} else {
  const { withSentryConfig } = require("@sentry/nextjs");
  module.exports = withSentryConfig(nextConfig, {
    org: process.env.SENTRY_ORG || "shakir-super-league",
    project: process.env.SENTRY_PROJECT || "ssl-web",
    silent: !process.env.CI,
    widenClientFileUpload: true,
    reactComponentAnnotation: {
      enabled: true,
    },
    tunnelRoute: "/monitoring",
    hideSourceMaps: true,
    disableLogger: true,
    automaticVercelMonitors: true,
  });
}
