import type { FullConfig } from "@playwright/test";

/**
 * Warms up the app before the first test.
 *
 * Against a dev server the first request to a route pays the compile cost.
 * Pre-compiling the key routes here keeps that cost out of test assertions,
 * which otherwise shows up as flaky ECONNRESET / timeouts.
 */
const WARMUP_ROUTES = [
  "/",
  "/leaderboards",
  "/offline",
  "/verify-otp",
  "/accept-invite",
  "/manifest.json",
  "/sw.js",
];

export default async function globalSetup(config: FullConfig) {
  const baseURL =
    process.env.BASE_URL ||
    config.projects[0]?.use?.baseURL ||
    "http://localhost:3001";

  for (const route of WARMUP_ROUTES) {
    try {
      await fetch(new URL(route, baseURL), { redirect: "manual" });
    } catch {
      // Warm-up is best-effort: a failure here must not fail the whole run,
      // the individual test will surface a real outage with a better message.
    }
  }
}