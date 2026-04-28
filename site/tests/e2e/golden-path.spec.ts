import { test, expect } from '@playwright/test';
import { FIXTURE } from '../utils/seed-fixtures';

test.describe('golden path', () => {
  test('land → sort → filter → drill-down → transcript → signature', async ({ page }) => {
    // 1. Land on leaderboard
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1, name: /Leaderboard/ })).toBeVisible();

    // 2. Sort by score
    await page.getByRole('button', { name: /Score/ }).click();
    await expect(page).toHaveURL(/sort=/);

    // 3. Filter to verified tier
    await page.getByLabel(/Verified/i).check();
    await expect(page).toHaveURL(/tier=verified/);

    // 4. Drill into top model
    await page.locator('table tbody tr').first().getByRole('link').first().click();
    await expect(page).toHaveURL(/\/models\//);

    // 5. From model, navigate to its runs
    await page.getByRole('link', { name: /Recent runs|All runs/i }).first().click();
    await expect(page).toHaveURL(/\/runs/);

    // 6. Open run detail
    const runLink = page.locator('a[href^="/runs/"]').first();
    await runLink.click();
    await expect(page).toHaveURL(/\/runs\//);

    // 7. Open the Signature tab
    await page.getByRole('tab', { name: /Signature/ }).click();
    await expect(page.getByText(/Signed payload|public key/i)).toBeVisible();

    // 8. Confirm Reproduction tab is reachable
    await page.getByRole('tab', { name: /Reproduction/ }).click();
    await expect(page.getByText(/Bundle|Download/i)).toBeVisible();
  });
});
