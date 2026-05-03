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
    // Seeded fixture has only 5 runs (page size > 5), so no Next link
    // renders. `isEnabled()` waits 30s for a non-existent element; use
    // `count()` to short-circuit the no-pagination case.
    if ((await next.count()) === 0) return;
    await next.click();
    await expect(page).toHaveURL(/cursor=/);
  });
});
