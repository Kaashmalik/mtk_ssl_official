import { test, expect } from '@playwright/test';

test.describe('Tournament Management', () => {
  test.beforeEach(async ({ page }) => {
    // Login as admin
    await page.goto('/login');
    await page.fill('[name="email"]', process.env.TEST_ADMIN_EMAIL || 'admin@test.ssl.cricket');
    await page.fill('[name="password"]', process.env.TEST_PASSWORD || 'testpass123');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/dashboard/);
  });

  test('should create a new tournament', async ({ page }) => {
    await page.goto('/dashboard/tournaments');
    await page.click('text=Create Tournament');

    // Fill tournament form
    await page.fill('[name="name"]', 'Test Premier League 2025');
    await page.selectOption('[name="format"]', 'round_robin');
    await page.fill('[name="maxTeams"]', '8');
    await page.fill('[name="startDate"]', '2025-06-01');
    await page.fill('[name="endDate"]', '2025-06-30');
    await page.fill('[name="entryFee"]', '5000');
    
    // Submit
    await page.click('button:has-text("Create Tournament")');

    // Verify creation
    await expect(page.locator('text=Test Premier League 2025')).toBeVisible();
    await expect(page.locator('[data-status="draft"]')).toBeVisible();
  });

  test('should add teams to tournament', async ({ page }) => {
    await page.goto('/dashboard/tournaments');
    await page.click('text=Test Premier League 2025');
    await page.click('text=Teams');
    await page.click('text=Add Team');

    // Fill team form
    await page.fill('[name="teamName"]', 'Karachi Kings');
    await page.fill('[name="captainName"]', 'Ali Khan');
    await page.click('button:has-text("Add Team")');

    // Verify team added
    await expect(page.locator('text=Karachi Kings')).toBeVisible();
  });

  test('should generate fixtures', async ({ page }) => {
    await page.goto('/dashboard/tournaments');
    await page.click('text=Test Premier League 2025');
    await page.click('text=Fixtures');
    await page.click('button:has-text("Generate Fixtures")');

    // Confirm generation
    await page.click('button:has-text("Confirm")');

    // Verify fixtures generated
    await expect(page.locator('[data-testid="match-card"]').first()).toBeVisible();
  });

  test('should start tournament', async ({ page }) => {
    await page.goto('/dashboard/tournaments');
    await page.click('text=Test Premier League 2025');
    await page.click('button:has-text("Start Tournament")');
    
    // Confirm
    await page.click('button:has-text("Start")');

    // Verify status changed
    await expect(page.locator('[data-status="live"]')).toBeVisible();
  });

  test('should view tournament standings', async ({ page }) => {
    await page.goto('/dashboard/tournaments');
    await page.click('text=Test Premier League 2025');
    await page.click('text=Standings');

    // Verify standings table
    await expect(page.locator('table')).toBeVisible();
    await expect(page.locator('th:has-text("Team")')).toBeVisible();
    await expect(page.locator('th:has-text("Points")')).toBeVisible();
    await expect(page.locator('th:has-text("NRR")')).toBeVisible();
  });
});

test.describe('Tournament Public View', () => {
  test('should display tournament list', async ({ page }) => {
    await page.goto('/tournaments');

    await expect(page.locator('[data-testid="tournament-card"]').first()).toBeVisible();
  });

  test('should filter tournaments by status', async ({ page }) => {
    await page.goto('/tournaments');
    
    await page.click('button:has-text("Live")');
    
    const cards = page.locator('[data-testid="tournament-card"]');
    for (const card of await cards.all()) {
      await expect(card.locator('[data-status="live"]')).toBeVisible();
    }
  });

  test('should search tournaments', async ({ page }) => {
    await page.goto('/tournaments');
    
    await page.fill('[placeholder*="Search"]', 'Premier');
    await page.waitForTimeout(500); // Debounce

    const cards = page.locator('[data-testid="tournament-card"]');
    for (const card of await cards.all()) {
      const text = await card.textContent();
      expect(text?.toLowerCase()).toContain('premier');
    }
  });

  test('should view tournament details', async ({ page }) => {
    await page.goto('/tournaments');
    await page.locator('[data-testid="tournament-card"]').first().click();

    await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator('text=Teams')).toBeVisible();
    await expect(page.locator('text=Fixtures')).toBeVisible();
    await expect(page.locator('text=Standings')).toBeVisible();
  });
});
