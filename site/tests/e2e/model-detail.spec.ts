import { test, expect } from '@playwright/test';
import { FIXTURE } from '../utils/seed-fixtures';

test.describe('/models/:slug', () => {
  test('renders header + stat tiles + history chart', async ({ page }) => {
    await page.goto(`/models/${FIXTURE.model.sonnet}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByText('Score')).toBeVisible();
    await expect(page.getByText('History')).toBeVisible();
  });

  test('navigates to runs feed', async ({ page }) => {
    await page.goto(`/models/${FIXTURE.model.sonnet}`);
    await page.getByText('See all').click();
    await expect(page).toHaveURL(new RegExp(`/models/${FIXTURE.model.sonnet}/runs`));
  });
});
