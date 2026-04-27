import { test, expect } from '@playwright/test';

test.describe('/leaderboard', () => {
  test('renders header + table + filter rail', async ({ page }) => {
    await page.goto('/leaderboard');
    await expect(page.getByRole('heading', { level: 1, name: /leaderboard/i })).toBeVisible();
    await expect(page.getByRole('table')).toBeVisible();
    await expect(page.getByRole('navigation', { name: /primary/i })).toBeVisible();
  });

  test('sort by Score reverses order on second click', async ({ page }) => {
    await page.goto('/leaderboard');
    const scoreHeader = page.getByRole('button', { name: /score/i });
    await scoreHeader.click();
    await expect(page).toHaveURL(/sort=avg_score%3Aasc/);
    await scoreHeader.click();
    await expect(page).toHaveURL(/sort=avg_score%3Adesc/);
  });

  test('filter chip removal updates URL', async ({ page }) => {
    await page.goto('/leaderboard?tier=verified');
    const chip = page.getByText(/tier: verified/i);
    await expect(chip).toBeVisible();
    await page.getByRole('button', { name: /remove filter tier/i }).click();
    await expect(page).not.toHaveURL(/tier=/);
  });
});
