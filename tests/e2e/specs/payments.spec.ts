import { test, expect } from '@playwright/test';

test.describe('Payment Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('[name="email"]', 'user@test.ssl.cricket');
    await page.fill('[name="password"]', 'testpass123');
    await page.click('button[type="submit"]');
  });

  test('should display payment options', async ({ page }) => {
    await page.goto('/tournament/test-tournament/register');
    
    // Verify payment options
    await expect(page.locator('text=JazzCash')).toBeVisible();
    await expect(page.locator('text=EasyPaisa')).toBeVisible();
    await expect(page.locator('text=Credit/Debit Card')).toBeVisible();
  });

  test('should process JazzCash payment', async ({ page }) => {
    await page.goto('/tournament/test-tournament/register');
    
    // Fill team details
    await page.fill('[name="teamName"]', 'Test Warriors');
    
    // Select JazzCash
    await page.click('text=JazzCash');
    await page.fill('[name="phone"]', '03001234567');
    
    // Mock JazzCash callback
    await page.route('**/jazzcash/callback', route => {
      route.fulfill({
        status: 200,
        body: JSON.stringify({
          status: 'success',
          transactionId: 'JC123456789',
        }),
      });
    });
    
    // Submit payment
    await page.click('button:has-text("Pay PKR")');
    
    // Verify success
    await expect(page.locator('text=Payment Successful')).toBeVisible({ timeout: 10000 });
  });

  test('should handle payment failure gracefully', async ({ page }) => {
    await page.goto('/tournament/test-tournament/register');
    
    await page.fill('[name="teamName"]', 'Test Warriors');
    await page.click('text=JazzCash');
    await page.fill('[name="phone"]', '03001234567');
    
    // Mock failed payment
    await page.route('**/api/payments/**', route => {
      route.fulfill({
        status: 400,
        body: JSON.stringify({
          error: 'Payment failed',
          message: 'Insufficient balance',
        }),
      });
    });
    
    await page.click('button:has-text("Pay PKR")');
    
    // Verify error message
    await expect(page.locator('text=Payment failed')).toBeVisible();
    await expect(page.locator('text=Try again')).toBeVisible();
  });

  test('should process Stripe payment', async ({ page }) => {
    await page.goto('/tournament/test-tournament/register');
    
    await page.fill('[name="teamName"]', 'Test Warriors');
    await page.click('text=Credit/Debit Card');
    
    // Fill card details (test card)
    await page.fill('[name="cardNumber"]', '4242424242424242');
    await page.fill('[name="expiry"]', '12/25');
    await page.fill('[name="cvc"]', '123');
    
    // Mock Stripe success
    await page.route('**/api/payments/**', route => {
      route.fulfill({
        status: 200,
        body: JSON.stringify({
          status: 'completed',
          paymentId: 'pi_test_123',
        }),
      });
    });
    
    await page.click('button:has-text("Pay PKR")');
    
    await expect(page.locator('text=Payment Successful')).toBeVisible({ timeout: 10000 });
  });

  test('should show payment history', async ({ page }) => {
    await page.goto('/dashboard/payments');
    
    await expect(page.locator('table')).toBeVisible();
    await expect(page.locator('th:has-text("Amount")')).toBeVisible();
    await expect(page.locator('th:has-text("Status")')).toBeVisible();
    await expect(page.locator('th:has-text("Date")')).toBeVisible();
  });

  test('should download payment receipt', async ({ page }) => {
    await page.goto('/dashboard/payments');
    
    // Click on a completed payment
    await page.locator('[data-status="completed"]').first().click();
    
    // Download receipt
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('button:has-text("Download Receipt")'),
    ]);
    
    expect(download.suggestedFilename()).toContain('receipt');
    expect(download.suggestedFilename()).toMatch(/\.(pdf|html)$/);
  });
});

test.describe('Refund Flow', () => {
  test('should request refund', async ({ page }) => {
    await page.goto('/login');
    await page.fill('[name="email"]', 'user@test.ssl.cricket');
    await page.fill('[name="password"]', 'testpass123');
    await page.click('button[type="submit"]');
    
    await page.goto('/dashboard/payments');
    
    // Find completed payment
    await page.locator('[data-status="completed"]').first().click();
    
    // Request refund
    await page.click('button:has-text("Request Refund")');
    await page.fill('[name="reason"]', 'Tournament cancelled');
    await page.click('button:has-text("Submit Request")');
    
    // Verify refund requested
    await expect(page.locator('text=Refund requested')).toBeVisible();
  });
});
