import { test, expect } from '@playwright/test';

test('/runs/:id hides nav + footer in print media', async ({ page }) => {
  await page.goto('/runs/seeded-run-id-1');
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('nav').first()).toBeHidden();
  await expect(page.locator('footer')).toBeHidden();
});
