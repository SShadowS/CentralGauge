import { expect, test } from "@playwright/test";

test.describe("/tasks", () => {
  test("table lists tasks", async ({ page }) => {
    await page.goto("/tasks");
    await expect(page.getByRole("heading", { level: 1, name: /Tasks/ }))
      .toBeVisible();
    await expect(page.locator("table tbody tr").first()).toBeVisible();
  });

  test("clicking a task opens its detail page", async ({ page }) => {
    await page.goto("/tasks");
    const link = page.locator('a[href^="/tasks/CG-"]').first();
    await link.click();
    await expect(page).toHaveURL(/\/tasks\/CG-/);
    await expect(page.getByText("Per-model results")).toBeVisible();
  });
});
