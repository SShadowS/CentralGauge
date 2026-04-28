import { test, expect } from '@playwright/test';
import { FIXTURE } from '../utils/seed-fixtures';

test.describe('/compare', () => {
  test('empty state when no models selected', async ({ page }) => {
    await page.goto('/compare');
    await expect(page.getByText('Add at least two model slugs')).toBeVisible();
  });

  test('two models render the at-a-glance + grid', async ({ page }) => {
    await page.goto(`/compare?models=${FIXTURE.model.sonnet},${FIXTURE.model.gpt5}`);
    await expect(page.getByText('At a glance')).toBeVisible();
    await expect(page.getByText('Per-task scores')).toBeVisible();
    await expect(page.locator('table thead th')).toHaveCount(3); // Task + 2 models
  });

  test('removing a chip drops it from the URL', async ({ page }) => {
    await page.goto(`/compare?models=${FIXTURE.model.sonnet},${FIXTURE.model.gpt5}`);
    await page.getByRole('button', { name: new RegExp(`Remove filter ${FIXTURE.model.sonnet}`) }).click();
    await expect(page).toHaveURL(new RegExp(`models=${FIXTURE.model.gpt5}`));
  });
});
