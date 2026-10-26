import { expect, test } from "@playwright/test";
import { e2eEnv, hasCredentials, signIn } from "../support/env";

/**
 * ENH-10 match chat: a signed-in member posts a message and sees it in the
 * log; link text is refused. Needs a published match in a league with chat
 * turned on (E2E_CHAT_MATCH_ID) and writes data, so it runs only with
 * E2E_ALLOW_WRITES=1 against staging/local.
 */
test.describe("Fan: match chat", () => {
  test.skip(!hasCredentials, "E2E_TEST_EMAIL / E2E_TEST_PASSWORD not configured");
  test.skip(!e2eEnv.allowWrites, "E2E_ALLOW_WRITES=1 not set (this journey posts a message)");
  test.skip(!e2eEnv.chatMatchId, "E2E_CHAT_MATCH_ID not configured");

  test.beforeEach(async ({ page }) => {
    await signIn(page);
    await page.goto(`/matches/${e2eEnv.chatMatchId}`);
    await expect(page.getByRole("heading", { name: /match chat/i })).toBeVisible({ timeout: 30_000 });
  });

  test("a posted message appears in the chat log", async ({ page }) => {
    const text = `E2E hello ${Date.now()}`;
    await page.getByLabel("Message").fill(text);
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByRole("log", { name: /match chat messages/i }).getByText(text)).toBeVisible();
  });

  test("links are refused before they are stored", async ({ page }) => {
    await page.getByLabel("Message").fill("free stream at www.example.com");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByText(/links are not allowed/i)).toBeVisible();
  });
});

test.describe("Match chat boundary", () => {
  test("the chat poll refuses anonymous visitors", async ({ request }) => {
    const response = await request.get("/api/matches/00000000-0000-4000-8000-000000000000/chat");
    // Anonymous: 401 (or a sign-in redirect from middleware); never chat data.
    expect([401, 403, 404, 307, 308]).toContain(response.status());
  });
});
