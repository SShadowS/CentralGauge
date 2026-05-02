import { expect, test } from "@playwright/test";

test.describe("cmd-K palette", () => {
  test("opens with ⌘K (Meta+K) and closes with Esc", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Meta+K");
    await expect(page.getByRole("dialog", { name: /command palette/i }))
      .toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: /command palette/i }))
      .toHaveCount(0);
  });

  test("typing filters and Enter navigates", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Meta+K");
    await page.getByRole("searchbox").fill("models");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/models/);
  });

  test("Nav button opens the palette", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Open command palette/i }).click();
    await expect(page.getByRole("dialog", { name: /command palette/i }))
      .toBeVisible();
  });
});
