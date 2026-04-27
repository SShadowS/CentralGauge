import { test, expect } from '@playwright/test';

test('/leaderboard skip-link is the first tab target', async ({ page }) => {
  await page.goto('/leaderboard');
  await page.keyboard.press('Tab');
  const focused = await page.evaluate(() => document.activeElement?.textContent);
  expect(focused?.toLowerCase()).toContain('skip');
});

test('/leaderboard sort header activates with Enter', async ({ page }) => {
  await page.goto('/leaderboard');
  // Tab past skip + nav links + theme toggle to reach the sortable header.
  // We use direct keyboard focus by clicking outside chrome first, then arrow.
  const scoreHeader = page.getByRole('button', { name: /score/i });
  await scoreHeader.focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/sort=avg_score/);
});
