import type { Page } from "@playwright/test";

/**
 * Shared E2E environment gates.
 *
 * Journeys that need credentials or seeded data are SKIPPED (never failed)
 * when the variables are missing, and a skipped test never counts as executed
 * acceptance (ENH-11-01).
 *
 *   E2E_TEST_EMAIL / E2E_TEST_PASSWORD  league owner test account (Clerk)
 *   E2E_ALLOW_WRITES=1                  allow journeys that create/modify data;
 *                                       set ONLY against staging/local, never
 *                                       production
 *   E2E_SCORING_MATCH_ID                a live match the test account may score
 *   E2E_CHAT_MATCH_ID                   a published match in a chat-enabled league
 *   E2E_VISUAL=1                        run screenshot comparisons
 */
export const e2eEnv = {
  email: process.env.E2E_TEST_EMAIL,
  password: process.env.E2E_TEST_PASSWORD,
  allowWrites: process.env.E2E_ALLOW_WRITES === "1",
  scoringMatchId: process.env.E2E_SCORING_MATCH_ID,
  chatMatchId: process.env.E2E_CHAT_MATCH_ID,
  visual: process.env.E2E_VISUAL === "1",
};

export const hasCredentials = Boolean(e2eEnv.email && e2eEnv.password);

/** Sign in through Clerk's own form, targeting fields by accessible name. */
export async function signIn(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel(/email/i).first().fill(e2eEnv.email!);
  const password = page.getByLabel(/password/i).first();
  // Clerk may show the password field only after "Continue".
  if (!(await password.isVisible().catch(() => false))) {
    await page.getByRole("button", { name: /continue/i }).first().click();
  }
  await password.fill(e2eEnv.password!);
  await page.getByRole("button", { name: /sign in|continue/i }).first().click();
  await page.waitForURL(/dashboard/, { timeout: 30_000 });
}
