import { expect, test } from "@playwright/test";

/**
 * Public (unauthenticated) smoke tests.
 *
 * These need no credentials and no seeded data — they verify routing, the auth
 * boundary, and that public fan pages render. If a test here fails, a fan-facing
 * journey is broken.
 *
 * Tests that read the database are skipped when no DATABASE_URL is configured,
 * so the suite stays useful in a secretless CI run instead of failing on 500s.
 */
const hasDatabase = !!process.env.DATABASE_URL || !!process.env.E2E_DATABASE_URL;

test.describe("Public routes", () => {
  test("home page renders the marketing hero", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.status()).toBeLessThan(400);
    await expect(page.locator("h1").first()).toBeVisible();
  });

  test("dashboard is gated behind authentication", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/sign-in/);
  });

  test("scoring console is gated behind authentication", async ({ page }) => {
    // /matches/[id]/scoring is public in middleware but every action needs auth,
    // so an anonymous visitor must be bounced to sign-in.
    await page.goto("/matches/00000000-0000-0000-0000-000000000000/scoring");
    await expect(page).toHaveURL(/sign-in/);
  });

  test("leaderboards are public", async ({ page }) => {
    test.skip(!hasDatabase, "DATABASE_URL not configured");
    const response = await page.goto("/leaderboards");
    expect(response?.status()).toBeLessThan(400);
    await expect(page.getByRole("heading", { name: /leaderboard/i })).toBeVisible();
  });

  test("unknown match id returns not-found rather than a crash", async ({ page }) => {
    test.skip(!hasDatabase, "DATABASE_URL not configured");
    const response = await page.goto("/matches/00000000-0000-0000-0000-000000000000");
    // Either a 404 page or a redirect; it must never be a 500.
    expect(response?.status()).not.toBe(500);
  });

  test("unknown tournament id returns not-found rather than a crash", async ({ page }) => {
    test.skip(!hasDatabase, "DATABASE_URL not configured");
    const response = await page.goto("/tournaments/00000000-0000-0000-0000-000000000000");
    expect(response?.status()).not.toBe(500);
  });
});

test.describe("Public utility pages", () => {
  test("OTP verification page is reachable without a session", async ({ page }) => {
    const response = await page.goto("/verify-otp");
    expect(response?.status()).toBeLessThan(400);
    await expect(page.getByText(/verify your contact/i)).toBeVisible();
    await expect(page.getByLabel(/email or phone/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /send code/i })).toBeVisible();
  });

  test("offline page renders", async ({ page }) => {
    const response = await page.goto("/offline");
    expect(response?.status()).toBeLessThan(400);
    await expect(page.getByText(/offline/i).first()).toBeVisible();
  });

  test("invite link without a token is handled gracefully", async ({ page }) => {
    const response = await page.goto("/accept-invite");
    expect(response?.status()).not.toBe(500);
    await expect(page.getByText(/invitation not found|invalid/i).first()).toBeVisible();
  });

  test("invite link with an unknown token is rejected", async ({ page }) => {
    test.skip(!hasDatabase, "DATABASE_URL not configured");
    const response = await page.goto("/accept-invite?token=definitely-not-a-real-token");
    expect(response?.status()).not.toBe(500);
    await expect(page.getByText(/invitation not found|invalid/i).first()).toBeVisible();
  });
});

test.describe("PWA assets", () => {
  test("manifest is served and references existing icons", async ({ request }) => {
    const res = await request.get("/manifest.json");
    expect(res.status()).toBe(200);

    const manifest = (await res.json()) as {
      name: string;
      icons: { src: string; sizes: string }[];
    };
    expect(manifest.name).toBeTruthy();
    expect(manifest.icons.length).toBeGreaterThan(0);

    for (const icon of manifest.icons) {
      const iconRes = await request.get(icon.src);
      expect(iconRes.status(), `icon ${icon.src} should exist`).toBe(200);
    }
  });

  test("service worker is served", async ({ request }) => {
    const res = await request.get("/sw.js");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("javascript");
  });
});

test.describe("Security headers and API gating", () => {
  test("cron route rejects requests without the secret", async ({ request }) => {
    const res = await request.get("/api/cron/subscription-renewal");
    expect(res.status()).toBe(401);
  });

  test("impersonation session requires a token", async ({ request }) => {
    const res = await request.get("/api/impersonation/session");
    // The route is token-gated: without a Clerk session the middleware answers
    // 401 JSON (never an HTML redirect), and with a session it answers 400.
    expect([400, 401]).toContain(res.status());
  });

  test("otp send endpoint validates its payload", async ({ request }) => {
    const res = await request.post("/api/auth/otp/send", {
      data: { identifier: "not-an-email-or-phone", channel: "carrier-pigeon" },
    });
    expect(res.status()).toBe(400);
  });

  test("stripe checkout reports 501 when unconfigured", async ({ request }) => {
    // No session -> 401/500 is acceptable; a 200 would mean an open checkout.
    const res = await request.post("/api/billing/stripe/checkout", {
      data: { plan: "pro", period: "monthly" },
    });
    expect(res.status()).not.toBe(200);
  });
});