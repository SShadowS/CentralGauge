import { expect, test } from "@playwright/test";

test.describe("/models", () => {
  test("renders heading and at least one family group", async ({ page }) => {
    await page.goto("/models");
    await expect(page.getByRole("heading", { level: 1, name: /Models/ }))
      .toBeVisible();
    await expect(page.locator("table tbody tr.group").first()).toBeVisible();
  });

  test("Has runs filter scopes the table", async ({ page }) => {
    await page.goto("/models");
    await page.getByLabel("With runs").check();
    await expect(page).toHaveURL(/has_runs=yes/);
  });
});
