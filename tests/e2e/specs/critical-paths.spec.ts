import { test, expect } from '@playwright/test';

test.describe('SSL Critical User Journeys', () => {
  test.describe('Authentication', () => {
    test('should redirect unauthenticated users to login', async ({ page }) => {
      await page.goto('/dashboard');
      await expect(page).toHaveURL(/.*sign-in.*/);
    });

    test('should login successfully with valid credentials', async ({ page }) => {
      await page.goto('/sign-in');
      await page.fill('[name="email"]', process.env.TEST_USER_EMAIL || 'test@ssl.cricket');
      await page.fill('[name="password"]', process.env.TEST_USER_PASSWORD || 'testpass123');
      await page.click('button[type="submit"]');
      await expect(page).toHaveURL('/dashboard');
    });
  });

  test.describe('Tournament Management', () => {
    test.beforeEach(async ({ page }) => {
      // Login before each test
      await page.goto('/sign-in');
      await page.fill('[name="email"]', process.env.TEST_ADMIN_EMAIL || 'admin@ssl.cricket');
      await page.fill('[name="password"]', process.env.TEST_ADMIN_PASSWORD || 'adminpass123');
      await page.click('button[type="submit"]');
      await page.waitForURL('/dashboard');
    });

    test('should create a new tournament', async ({ page }) => {
      await page.click('text=Tournaments');
      await page.click('text=Create Tournament');
      
      await page.fill('[name="name"]', 'Test Premier League 2025');
      await page.selectOption('[name="format"]', 'round-robin');
      await page.fill('[name="startDate"]', '2025-06-01');
      await page.fill('[name="endDate"]', '2025-06-30');
      await page.fill('[name="maxTeams"]', '8');
      
      await page.click('button:has-text("Create Tournament")');
      
      await expect(page.locator('text=Test Premier League 2025')).toBeVisible();
      await expect(page.locator('[data-testid="tournament-status"]')).toContainText('Draft');
    });

    test('should add teams to tournament', async ({ page }) => {
      await page.goto('/tournaments/test-premier-league-2025');
      await page.click('text=Teams');
      await page.click('text=Add Team');
      
      await page.fill('[name="teamName"]', 'Test Warriors');
      await page.fill('[name="captainEmail"]', 'captain@test.com');
      
      await page.click('button:has-text("Add Team")');
      
      await expect(page.locator('text=Test Warriors')).toBeVisible();
    });
  });

  test.describe('Live Scoring', () => {
    test('should connect to live match', async ({ page }) => {
      await page.goto('/matches/live/test-match-001');
      
      // Wait for WebSocket connection
      await page.waitForSelector('[data-testid="connection-status"]:has-text("Connected")');
      
      await expect(page.locator('[data-testid="live-score"]')).toBeVisible();
    });

    test('should update score in real-time', async ({ page, context }) => {
      // Open viewer page
      const viewerPage = await context.newPage();
      await viewerPage.goto('/matches/live/test-match-001');
      await viewerPage.waitForSelector('[data-testid="connection-status"]:has-text("Connected")');
      
      // Open scorer page
      await page.goto('/scorer/test-match-001');
      await page.waitForSelector('[data-testid="scorer-ready"]');
      
      // Record a boundary
      await page.click('[data-runs="4"]');
      await page.click('button:has-text("Confirm")');
      
      // Verify update on viewer page
      await expect(viewerPage.locator('[data-testid="total-runs"]')).toContainText('4');
    });
  });

  test.describe('Mobile Responsiveness', () => {
    test.use({ viewport: { width: 375, height: 667 } }); // iPhone SE

    test('should display mobile navigation', async ({ page }) => {
      await page.goto('/');
      
      // Desktop nav should be hidden
      await expect(page.locator('[data-testid="desktop-nav"]')).toBeHidden();
      
      // Mobile hamburger should be visible
      await expect(page.locator('[data-testid="mobile-menu-button"]')).toBeVisible();
      
      // Open mobile menu
      await page.click('[data-testid="mobile-menu-button"]');
      await expect(page.locator('[data-testid="mobile-nav"]')).toBeVisible();
    });

    test('should have touch-friendly buttons', async ({ page }) => {
      await page.goto('/scorer/test-match-001');
      
      // All scoring buttons should be at least 44x44px
      const scoringButtons = await page.locator('[data-testid="scoring-button"]').all();
      
      for (const button of scoringButtons) {
        const box = await button.boundingBox();
        expect(box?.width).toBeGreaterThanOrEqual(44);
        expect(box?.height).toBeGreaterThanOrEqual(44);
      }
    });
  });

  test.describe('PWA Features', () => {
    test('should have valid manifest', async ({ page }) => {
      await page.goto('/');
      
      const manifestLink = await page.locator('link[rel="manifest"]');
      await expect(manifestLink).toHaveAttribute('href', '/manifest.json');
      
      const response = await page.request.get('/manifest.json');
      expect(response.ok()).toBeTruthy();
      
      const manifest = await response.json();
      expect(manifest.name).toBe('Shakir Super League');
      expect(manifest.start_url).toBe('/');
      expect(manifest.display).toBe('standalone');
    });

    test('should register service worker', async ({ page }) => {
      await page.goto('/');
      
      // Wait for service worker registration
      const swRegistered = await page.evaluate(async () => {
        if ('serviceWorker' in navigator) {
          const registration = await navigator.serviceWorker.ready;
          return !!registration;
        }
        return false;
      });
      
      expect(swRegistered).toBeTruthy();
    });
  });

  test.describe('Accessibility', () => {
    test('should have no critical accessibility violations', async ({ page }) => {
      await page.goto('/');
      
      // Basic accessibility checks
      const mainContent = page.locator('main');
      await expect(mainContent).toBeVisible();
      
      // All images should have alt text
      const images = await page.locator('img').all();
      for (const img of images) {
        const alt = await img.getAttribute('alt');
        expect(alt).not.toBeNull();
      }
      
      // Interactive elements should be focusable
      const buttons = await page.locator('button:visible').all();
      for (const button of buttons) {
        const tabIndex = await button.getAttribute('tabindex');
        expect(tabIndex).not.toBe('-1');
      }
    });
  });

  test.describe('Performance', () => {
    test('should load homepage within performance budget', async ({ page }) => {
      await page.goto('/');
      
      const performanceTimings = await page.evaluate(() => {
        const timing = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
        return {
          fcp: performance.getEntriesByName('first-contentful-paint')[0]?.startTime,
          lcp: performance.getEntriesByType('largest-contentful-paint').pop()?.startTime,
          domContentLoaded: timing.domContentLoadedEventEnd - timing.startTime,
          load: timing.loadEventEnd - timing.startTime,
        };
      });
      
      // FCP should be under 1.5s
      if (performanceTimings.fcp) {
        expect(performanceTimings.fcp).toBeLessThan(1500);
      }
      
      // DOM Content Loaded under 3s
      expect(performanceTimings.domContentLoaded).toBeLessThan(3000);
    });
  });
});
