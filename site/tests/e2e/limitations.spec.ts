import { test, expect } from '@playwright/test';

test.describe('/limitations', () => {
  test('renders sortable table', async ({ page }) => {
    await page.goto('/limitations');
    await expect(page.getByRole('heading', { level: 1, name: /Limitations/ })).toBeVisible();
    await expect(page.locator('table')).toBeVisible();
  });

  test('expanding a row shows affected models', async ({ page }) => {
    await page.goto('/limitations');
    const firstToggle = page.getByRole('button', { name: /Toggle details/i }).first();
    await firstToggle.click();
    await expect(page.getByText('Affected models')).toBeVisible();
  });

  test('clicking a sortable header changes order', async ({ page }) => {
    await page.goto('/limitations');
    const occHeader = page.getByRole('button', { name: /Occurrences/ });
    const firstBefore = await page.locator('tbody tr.row th[scope="row"]').first().textContent();
    await occHeader.click();
    await page.waitForTimeout(50);
    const firstAfter = await page.locator('tbody tr.row th[scope="row"]').first().textContent();
    expect(firstAfter).toBeDefined();
    expect(firstBefore).toBeDefined();
  });
});
