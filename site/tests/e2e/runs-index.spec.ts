import { expect, test } from "@playwright/test";

test.describe("/runs", () => {
  test("renders the runs table", async ({ page }) => {
    await page.goto("/runs");
    await expect(page.getByRole("heading", { level: 1, name: /Runs/ }))
      .toBeVisible();
    await expect(page.locator("table")).toBeVisible();
  });

  test("Next link advances cursor", async ({ page }) => {
    await page.goto("/runs");
    const next = page.getByRole("link", { name: /Next/ });
    if (await next.isEnabled()) {
      await next.click();
      await expect(page).toHaveURL(/cursor=/);
    }
  });
});
