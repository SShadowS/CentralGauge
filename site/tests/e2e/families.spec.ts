import { expect, test } from "@playwright/test";

test.describe("/families", () => {
  test("grid renders one card per family", async ({ page }) => {
    await page.goto("/families");
    await expect(page.getByRole("heading", { level: 1, name: /Families/ }))
      .toBeVisible();
    await expect(page.locator("article").first()).toBeVisible();
  });

  test("clicking a family card opens its detail page", async ({ page }) => {
    await page.goto("/families");
    const card = page.locator('a[href^="/families/"]').first();
    await card.click();
    await expect(page).toHaveURL(/\/families\/[^/]+$/);
    await expect(page.getByText("Trajectory")).toBeVisible();
  });
});
