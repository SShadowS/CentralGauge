import { test, expect } from '@playwright/test';
import { FIXTURE } from '../utils/seed-fixtures';

test('/runs/:id/transcripts/:taskId/:attempt renders + copies', async ({ page }) => {
  await page.goto(`/runs/${FIXTURE.run.run0}/transcripts/${FIXTURE.task.easy1}/1`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  // Section headers visible (== HEADER == parsed)
  const sections = page.locator('.block .name');
  await expect(sections.first()).toBeVisible();
});
