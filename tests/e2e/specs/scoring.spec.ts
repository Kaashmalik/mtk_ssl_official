import { expect, test, type Page } from "@playwright/test";
import { e2eEnv, hasCredentials, signIn } from "../support/env";

/**
 * ENH-11-01: a scorer records a ball on the real scoring route and the score
 * moves only after the server confirms it; undo restores it. Needs a live
 * match the test account may score (E2E_SCORING_MATCH_ID) and writes data, so
 * it runs only with E2E_ALLOW_WRITES=1 against staging/local. The test undoes
 * its own ball so the fixture can be reused.
 */

function runsOf(text: string | null): number {
  const match = text?.match(/(\d+)\s*\/\s*(\d+)/);
  if (!match) throw new Error(`Unreadable score: ${text}`);
  return Number(match[1]);
}

async function currentRuns(page: Page) {
  return runsOf(await page.getByTestId("innings-score").first().textContent());
}

test.describe("Scorer: record a ball", () => {
  test.skip(!hasCredentials, "E2E_TEST_EMAIL / E2E_TEST_PASSWORD not configured");
  test.skip(!e2eEnv.allowWrites, "E2E_ALLOW_WRITES=1 not set (this journey writes a ball)");
  test.skip(!e2eEnv.scoringMatchId, "E2E_SCORING_MATCH_ID not configured");

  test.beforeEach(async ({ page }) => {
    await signIn(page);
    await page.goto(`/matches/${e2eEnv.scoringMatchId}/scoring`);
    await expect(page.getByTestId("innings-score").first()).toBeVisible({ timeout: 30_000 });
  });

  test("one run is recorded, then undone", async ({ page }) => {
    const before = await currentRuns(page);

    await page.getByRole("button", { name: "Record 1" }).click();
    await expect.poll(() => currentRuns(page), { timeout: 20_000 }).toBe(before + 1);

    await page.getByRole("button", { name: "Undo" }).click();
    await expect.poll(() => currentRuns(page), { timeout: 20_000 }).toBe(before);
  });
});
// The anonymous-scoring gate is covered in public-smoke.spec.ts.
