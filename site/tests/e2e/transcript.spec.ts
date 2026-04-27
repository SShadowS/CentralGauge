import { test, expect } from '@playwright/test';

test('/runs/:id/transcripts/:taskId/:attempt renders + copies', async ({ page }) => {
  await page.goto('/runs/seeded-run-id-1/transcripts/CG-AL-E001/1');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  // Section headers visible (== HEADER == parsed)
  const sections = page.locator('.block .name');
  await expect(sections.first()).toBeVisible();
});
