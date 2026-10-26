import { expect, test } from "@playwright/test";
import { e2eEnv, hasCredentials, signIn } from "../support/env";

/**
 * ENH-11-01: organizer creates a tournament through the real form at
 * /dashboard/tournaments/new. Creates data, so it runs only with
 * E2E_ALLOW_WRITES=1 against staging/local.
 */
test.describe("Organizer: create a tournament", () => {
  test.skip(!hasCredentials, "E2E_TEST_EMAIL / E2E_TEST_PASSWORD not configured");
  test.skip(!e2eEnv.allowWrites, "E2E_ALLOW_WRITES=1 not set (this journey creates data)");

  test.beforeEach(async ({ page }) => {
    await signIn(page);
  });

  test("a new tournament appears in the list after creation", async ({ page }) => {
    const name = `E2E League ${Date.now()}`;
    await page.goto("/dashboard/tournaments/new");
    await page.getByLabel(/tournament name/i).fill(name);
    await page.getByLabel(/description/i).fill("Created by the end-to-end suite.");

    const create = page.getByRole("button", { name: /create tournament/i });
    await expect(create).toBeEnabled();
    await create.click();

    await page.waitForURL(/\/dashboard\/tournaments\/?$/, { timeout: 30_000 });
    await expect(page.getByText(name).first()).toBeVisible();
  });

  test("the create button stays disabled without a name", async ({ page }) => {
    await page.goto("/dashboard/tournaments/new");
    await expect(page.getByRole("button", { name: /create tournament/i })).toBeDisabled();
  });
});

test.describe("Public: tournaments", () => {
  test("an unknown tournament id is a not-found page, not a crash", async ({ page }) => {
    test.skip(!process.env.DATABASE_URL && !process.env.E2E_DATABASE_URL, "DATABASE_URL not configured");
    const response = await page.goto("/tournaments/00000000-0000-4000-8000-000000000000");
    expect(response?.status()).toBe(404);
  });
});
