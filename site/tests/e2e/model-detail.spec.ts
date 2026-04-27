import { test, expect } from '@playwright/test';

test.describe('/models/:slug', () => {
  test('renders header + stat tiles + history chart', async ({ page }) => {
    await page.goto('/models/sonnet-4-7');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByText('Score')).toBeVisible();
    await expect(page.getByText('History')).toBeVisible();
  });

  test('navigates to runs feed', async ({ page }) => {
    await page.goto('/models/sonnet-4-7');
    await page.getByText('See all').click();
    await expect(page).toHaveURL(/\/models\/sonnet-4-7\/runs/);
  });
});
