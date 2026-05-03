import { expect, test } from "@playwright/test";

test.describe("/search", () => {
  test("input is auto-focused on load", async ({ page }) => {
    await page.goto("/search");
    await expect(page.getByRole("searchbox")).toBeFocused();
  });

  test("typing pushes ?q= to the URL", async ({ page }) => {
    // networkidle: the URL push lives in a Svelte $effect that wires up
    // during hydration. Default `load` returns before that — typing
    // before hydration is a no-op for the URL.
    await page.goto("/search", { waitUntil: "networkidle" });
    await page.getByRole("searchbox").fill("AL0132");
    await page.waitForURL(/q=AL0132/, { timeout: 1500 });
  });

  test("a known query renders <mark> in the result", async ({ page }) => {
    await page.goto("/search?q=AL0132");
    const marks = page.locator("mark");
    await expect(marks.first()).toBeVisible({ timeout: 5000 });
  });
});
