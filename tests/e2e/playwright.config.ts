import { defineConfig, devices } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * E2E configuration for the SSL platform.
 *
 * - BASE_URL points at the web app (default dev port 3001).
 * - Locally we boot `pnpm --filter @mtk/web dev`; in CI the app is already
 *   built and served, so no webServer is started.
 * - CI runs Chromium only (fast, deterministic). The full matrix is for local
 *   runs, where you can catch browser-specific layout bugs.
 */
const isCI = !!process.env.CI;
const baseURL = process.env.BASE_URL || "http://localhost:3001";

/**
 * Next.js loads .env.development ahead of .env in dev mode, so a local dev
 * server would silently talk to a different database than the one migrations
 * were applied to. When E2E_DATABASE_URL is not given, fall back to DATABASE_URL
 * from the repo-root .env so tests exercise the same database as the tooling.
 */
function resolveWebServerEnv(): Record<string, string> {
  if (process.env.E2E_DATABASE_URL) return { DATABASE_URL: process.env.E2E_DATABASE_URL };

  const rootEnv = resolve(process.cwd(), "../../.env");
  if (existsSync(rootEnv)) {
    const match = readFileSync(rootEnv, "utf8").match(/^DATABASE_URL=(.+)$/m);
    if (match) return { DATABASE_URL: match[1].trim() };
  }
  return {};
}

export default defineConfig({
  testDir: "./specs",
  globalSetup: "./global-setup.ts",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  // A cold Next dev server cannot compile routes in parallel with assertions
  // hitting them. Run serially against dev; CI builds first, so it can fan out.
  workers: isCI ? 2 : 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: isCI
    ? [["github"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],

  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },

  projects: isCI
    ? [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }]
    : [
        { name: "chromium", use: { ...devices["Desktop Chrome"] } },
        { name: "firefox", use: { ...devices["Desktop Firefox"] } },
        { name: "webkit", use: { ...devices["Desktop Safari"] } },
        { name: "Mobile Chrome", use: { ...devices["Pixel 5"] } },
        { name: "Mobile Safari", use: { ...devices["iPhone 13"] } },
      ],

  webServer: isCI
    ? undefined
    : {
        command: "pnpm --filter @mtk/web dev",
        url: baseURL,
        reuseExistingServer: true,
        timeout: 180_000,
        stdout: "ignore",
        stderr: "pipe",
        env: resolveWebServerEnv(),
      },
});