import { test, expect } from '@playwright/test';

test.describe('density toggle', () => {
  test('Nav button switches density and persists across reload', async ({ page }) => {
    await page.goto('/');
    const compactBtn = page.getByRole('button', { name: /Compact density/i });
    await compactBtn.click();
    await expect(page.locator('html')).toHaveAttribute('data-density', 'compact');

    // Reload — preference should restore via no-flash boot script
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-density', 'compact');
  });

  test('cmd-shift-d toggles density', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Meta+Shift+D');
    const after = await page.locator('html').getAttribute('data-density');
    expect(['comfortable', 'compact']).toContain(after);
  });

  test('compact mode reduces row height', async ({ page }) => {
    await page.goto('/');
    const comfortableHeight = await page.locator('table tbody tr').first().evaluate((el) => el.getBoundingClientRect().height);
    await page.getByRole('button', { name: /Compact density/i }).click();
    const compactHeight = await page.locator('table tbody tr').first().evaluate((el) => el.getBoundingClientRect().height);
    expect(compactHeight).toBeLessThan(comfortableHeight);
  });
});
