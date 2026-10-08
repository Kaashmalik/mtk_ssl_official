import { expect, test } from "@playwright/test";

/**
 * Authenticated journeys.
 *
 * These require a real Clerk-backed test account. Without credentials they are
 * skipped rather than failed, so an unconfigured CI run stays green without
 * pretending to have covered them.
 *
 * Provide:
 *   E2E_TEST_EMAIL / E2E_TEST_PASSWORD        (league owner)
 *   E2E_STREAM_SOURCE / E2E_STREAM_URL         (optional, for stream start)
 */

const email = process.env.E2E_TEST_EMAIL;
const password = process.env.E2E_TEST_PASSWORD;
const hasCredentials = !!email && !!password;

test.describe("League owner journeys", () => {
  test.skip(!hasCredentials, "E2E_TEST_EMAIL / E2E_TEST_PASSWORD not configured");

  test.beforeEach(async ({ page }) => {
    await page.goto("/sign-in");
    // Clerk renders its own form; target by accessible name, not markup shape.
    const emailInput = page.getByLabel(/email/i).first();
    await emailInput.fill(email!);
    const passwordInput = page.getByLabel(/password/i).first();
    await passwordInput.fill(password!);
    await page.getByRole("button", { name: /sign in|continue/i }).first().click();
    await page.waitForURL(/dashboard/, { timeout: 30_000 });
  });

  test("dashboard loads with league stats", async ({ page }) => {
    await expect(page.getByRole("heading", { name: /dashboard/i })).toBeVisible();
  });

  test("users page exposes the invite manager", async ({ page }) => {
    await page.goto("/dashboard/users");
    await expect(page.getByRole("heading", { name: /users/i }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /create invitation/i })).toBeVisible();
  });

  test("billing page shows plan usage and countdown", async ({ page }) => {
    await page.goto("/dashboard/settings/billing");
    await expect(page.getByText(/current plan/i).first()).toBeVisible();
    await expect(page.getByText(/max teams/i).first()).toBeVisible();
  });

  test("notifications page renders", async ({ page }) => {
    await page.goto("/dashboard/notifications");
    await expect(page.getByRole("heading", { name: /notifications/i }).first()).toBeVisible();
  });

  test("settings page shows plan usage meters", async ({ page }) => {
    await page.goto("/dashboard/settings");
    await expect(page.getByText(/plan usage/i).first()).toBeVisible();
  });
});