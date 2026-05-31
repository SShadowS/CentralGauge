import { expect, test } from "@playwright/test";

test.describe("/models", () => {
  test("renders heading and at least one family group", async ({ page }) => {
    await page.goto("/models");
    await expect(page.getByRole("heading", { level: 1, name: /Models/ }))
      .toBeVisible();
    await expect(page.locator("table tbody tr.group").first()).toBeVisible();
  });

  test("Has runs filter scopes the table", async ({ page }) => {
    // networkidle: the "With runs" Radio's onchange (-> pushFilter -> goto) is
    // wired only during Svelte hydration. Default `load` returns before that,
    // so a bare goto + check() checks the radio natively before the handler
    // exists and the navigation never fires.
    await page.goto("/models", { waitUntil: "networkidle" });
    await page.getByLabel("With runs").check();
    await expect(page).toHaveURL(/has_runs=yes/);
  });
});
