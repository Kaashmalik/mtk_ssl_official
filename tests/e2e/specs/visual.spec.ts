import { expect, test } from "@playwright/test";
import { e2eEnv } from "../support/env";

/**
 * Visual regression for the public surfaces (UI plan follow-up backlog).
 *
 * Opt-in with E2E_VISUAL=1 and Chromium only: screenshots differ across
 * browsers and operating systems, so baselines must be created on the machine
 * type that compares them (normally the Linux CI runner):
 *
 *   E2E_VISUAL=1 pnpm --filter @mtk/e2e test:e2e visual --project=chromium --update-snapshots
 *
 * Live data (the hub activity strip, the footer year) is masked so a baseline
 * only fails on real layout or styling changes. Animations are disabled.
 */
test.describe("Visual regression", () => {
  test.skip(!e2eEnv.visual, "E2E_VISUAL=1 not set");
  test.skip(({ browserName }) => browserName !== "chromium", "Baselines are Chromium-only");

  test.use({ colorScheme: "light", reducedMotion: "reduce" });

  const viewports = [
    { name: "desktop", width: 1440, height: 900 },
    { name: "mobile", width: 390, height: 844 },
  ] as const;

  for (const viewport of viewports) {
    test(`landing page - ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto("/");
      await page.evaluate(() => document.fonts.ready);
      await expect(page).toHaveScreenshot(`landing-${viewport.name}.png`, {
        fullPage: true,
        animations: "disabled",
        mask: [page.locator('section[aria-labelledby="pulse-heading"]'), page.locator("footer p")],
        maxDiffPixelRatio: 0.01,
      });
    });

    test(`landing page dark - ${viewport.name}`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: "dark" });
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto("/");
      await page.evaluate(() => document.fonts.ready);
      await expect(page).toHaveScreenshot(`landing-dark-${viewport.name}.png`, {
        animations: "disabled",
        mask: [page.locator('section[aria-labelledby="pulse-heading"]')],
        maxDiffPixelRatio: 0.01,
      });
    });
  }

  test("sign-in page - desktop", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/sign-in");
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveScreenshot("sign-in-desktop.png", { animations: "disabled", maxDiffPixelRatio: 0.02 });
  });
});
