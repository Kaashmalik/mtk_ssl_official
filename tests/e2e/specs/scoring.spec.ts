import { test, expect } from '@playwright/test';

test.describe('Live Scoring', () => {
  test.beforeEach(async ({ page }) => {
    // Login as scorer
    await page.goto('/scorer/login');
    await page.fill('[name="matchCode"]', process.env.TEST_MATCH_CODE || 'TEST-001');
    await page.fill('[name="pin"]', process.env.TEST_SCORER_PIN || '1234');
    await page.click('button[type="submit"]');
    await expect(page).toHaveURL(/scorer\/match/);
  });

  test('should display scoring interface', async ({ page }) => {
    // Verify scoring buttons
    await expect(page.locator('[data-testid="scoring-button"]').first()).toBeVisible();
    await expect(page.locator('button:has-text("0")')).toBeVisible();
    await expect(page.locator('button:has-text("1")')).toBeVisible();
    await expect(page.locator('button:has-text("4")')).toBeVisible();
    await expect(page.locator('button:has-text("6")')).toBeVisible();
    await expect(page.locator('button:has-text("W")')).toBeVisible();
  });

  test('should record runs', async ({ page }) => {
    const initialScore = await page.locator('[data-testid="total-score"]').textContent();
    
    // Click 4 runs
    await page.click('button:has-text("4")');
    await page.click('button:has-text("Confirm")');
    
    // Verify score updated
    const newScore = await page.locator('[data-testid="total-score"]').textContent();
    expect(parseInt(newScore || '0')).toBe(parseInt(initialScore || '0') + 4);
  });

  test('should record wicket', async ({ page }) => {
    const initialWickets = await page.locator('[data-testid="wickets"]').textContent();
    
    // Click wicket
    await page.click('button:has-text("W")');
    
    // Select dismissal type
    await page.click('button:has-text("Bowled")');
    
    // Confirm
    await page.click('button:has-text("Confirm Wicket")');
    
    // Verify wicket count increased
    const newWickets = await page.locator('[data-testid="wickets"]').textContent();
    expect(parseInt(newWickets || '0')).toBe(parseInt(initialWickets || '0') + 1);
  });

  test('should record extras', async ({ page }) => {
    const initialExtras = await page.locator('[data-testid="extras"]').textContent();
    
    // Click wide
    await page.click('button:has-text("Wd")');
    
    // Confirm
    await page.click('button:has-text("Confirm")');
    
    // Verify extras increased
    const newExtras = await page.locator('[data-testid="extras"]').textContent();
    expect(parseInt(newExtras || '0')).toBeGreaterThan(parseInt(initialExtras || '0'));
  });

  test('should undo last ball', async ({ page }) => {
    // Record a ball
    await page.click('button:has-text("2")');
    await page.click('button:has-text("Confirm")');
    
    const scoreAfterBall = await page.locator('[data-testid="total-score"]').textContent();
    
    // Undo
    await page.click('button:has-text("Undo")');
    await page.click('button:has-text("Confirm Undo")');
    
    // Verify score reverted
    const scoreAfterUndo = await page.locator('[data-testid="total-score"]').textContent();
    expect(parseInt(scoreAfterUndo || '0')).toBe(parseInt(scoreAfterBall || '0') - 2);
  });

  test('should switch innings', async ({ page }) => {
    await page.click('button:has-text("End Innings")');
    
    // Confirm
    await page.click('button:has-text("Confirm End Innings")');
    
    // Verify innings switched
    await expect(page.locator('[data-testid="current-inning"]:has-text("2")')).toBeVisible();
  });

  test('should end match', async ({ page }) => {
    await page.click('button:has-text("End Match")');
    
    // Select winner
    await page.click('[data-testid="winner-select"]');
    await page.click('text=Team A');
    
    // Confirm
    await page.click('button:has-text("Confirm End Match")');
    
    // Verify match ended
    await expect(page).toHaveURL(/scorer\/match\/.*\/completed/);
  });
});

test.describe('Live Score Viewer', () => {
  test('should display live score', async ({ page }) => {
    await page.goto('/match/TEST-001');
    
    await expect(page.locator('[data-testid="live-score"]')).toBeVisible();
    await expect(page.locator('[data-testid="team-name"]').first()).toBeVisible();
  });

  test('should receive real-time updates', async ({ page, context }) => {
    // Open viewer
    await page.goto('/match/TEST-001');
    const initialScore = await page.locator('[data-testid="live-score"]').textContent();
    
    // Open scorer in new page
    const scorerPage = await context.newPage();
    await scorerPage.goto('/scorer/login');
    await scorerPage.fill('[name="matchCode"]', 'TEST-001');
    await scorerPage.fill('[name="pin"]', '1234');
    await scorerPage.click('button[type="submit"]');
    
    // Score a run
    await scorerPage.click('button:has-text("1")');
    await scorerPage.click('button:has-text("Confirm")');
    
    // Wait for WebSocket update
    await page.waitForTimeout(1000);
    
    // Verify viewer updated
    const newScore = await page.locator('[data-testid="live-score"]').textContent();
    expect(parseInt(newScore || '0')).toBeGreaterThan(parseInt(initialScore || '0'));
  });

  test('should display ball-by-ball commentary', async ({ page }) => {
    await page.goto('/match/TEST-001');
    
    await expect(page.locator('[data-testid="ball-by-ball"]')).toBeVisible();
    await expect(page.locator('[data-testid="ball-event"]').first()).toBeVisible();
  });

  test('should show AI commentary', async ({ page }) => {
    await page.goto('/match/TEST-001');
    
    // Check for AI commentary section
    await expect(page.locator('[data-testid="ai-commentary"]')).toBeVisible();
    
    // Toggle language
    await page.click('button:has-text("اردو")');
    await expect(page.locator('[data-testid="ai-commentary"][lang="ur"]')).toBeVisible();
  });
});
