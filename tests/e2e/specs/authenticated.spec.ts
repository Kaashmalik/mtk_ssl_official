import { expect, test } from "@playwright/test";
import { hasCredentials, signIn } from "../support/env";

/**
 * Authenticated journeys (read-only).
 *
 * These require a real Clerk-backed test account. Without credentials they are
 * skipped rather than failed, so an unconfigured CI run stays green without
 * pretending to have covered them. See ../support/env.ts for variables.
 */

test.describe("League owner journeys", () => {
  test.skip(!hasCredentials, "E2E_TEST_EMAIL / E2E_TEST_PASSWORD not configured");

  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test("dashboard loads with league stats", async ({ page }) => {
    await expect(page.getByRole("heading", { name: /dashboard/i })).toBeVisible();
  });

  test("main navigation reaches each area and marks the active route", async ({ page }) => {
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    for (const [label, path] of [
      [/tournaments/i, "/dashboard/tournaments"],
      [/teams/i, "/dashboard/teams"],
      [/matches/i, "/dashboard/matches"],
    ] as const) {
      const link = nav.getByRole("link", { name: label }).first();
      await link.click();
      await page.waitForURL(new RegExp(`${path}/?$`));
      await expect(nav.locator(`a[href="${path}"]`).first()).toHaveAttribute("aria-current", "page");
    }
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

  test("fan interactions settings expose the match chat switch", async ({ page }) => {
    await page.goto("/dashboard/settings/fan-interactions");
    await expect(page.getByRole("switch", { name: "Match chat" })).toBeVisible();
  });
});
