import { expect, test } from "@playwright/test";

test.describe("/", () => {
  test("renders header + table + filter rail", async ({ page }) => {
    // Hero chart (c19efe5) replaced the "Leaderboard" h1 with the
    // CentralGauge brand mark. The leaderboard table itself remains the
    // primary page content.
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: /centralgauge/i }))
      .toBeVisible();
    await expect(page.getByRole("table")).toBeVisible();
    await expect(page.getByRole("navigation", { name: /primary/i }))
      .toBeVisible();
  });

  test("sort by Solve AUC@2 reverses order on second click", async ({ page }) => {
    // networkidle: sort handlers are wired during Svelte hydration, which
    // races the click under parallel load (3/5 flake observed without it).
    await page.goto("/", { waitUntil: "networkidle" });
    // The headline column is now "Solve AUC@2" (data-test="auc-2-header").
    // Default sort is auc_2:desc; first click flips to auc_2:asc, second back.
    const auc2Header = page.locator("[data-test='auc-2-header'] button");
    await auc2Header.click();
    await expect(page).toHaveURL(/sort=auc_2%3Aasc/);
    await auc2Header.click();
    await expect(page).toHaveURL(/sort=auc_2%3Adesc/);
  });

  test("filter chip removal updates URL", async ({ page }) => {
    // `tier` is a tab-style toggle (not in FILTER_KEYS), so it doesn't
    // render as a removable chip. Use a real filter (`family`) instead.
    await page.goto("/?family=claude", { waitUntil: "networkidle" });
    const chip = page.getByText(/family: claude/i);
    await expect(chip).toBeVisible();
    await page.getByRole("button", { name: /remove filter family/i }).click();
    await expect(page).not.toHaveURL(/family=/);
  });
});
