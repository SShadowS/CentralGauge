import { expect, test } from "@playwright/test";

test.describe("cmd-K palette", () => {
  test("opens with ⌘K (Meta+K) and closes with Esc", async ({ page }) => {
    // networkidle: cmd-K is bound via <svelte:window onkeydown> in
    // +layout.svelte; the handler is wired only after hydration.
    await page.goto("/", { waitUntil: "networkidle" });
    await page.keyboard.press("Meta+K");
    await expect(page.getByRole("dialog", { name: /command palette/i }))
      .toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: /command palette/i }))
      .toHaveCount(0);
  });

  test("typing filters and Enter navigates", async ({ page }) => {
    // networkidle: cmd-K is bound via <svelte:window onkeydown> in
    // +layout.svelte; the handler is wired only after hydration.
    await page.goto("/", { waitUntil: "networkidle" });
    await page.keyboard.press("Meta+K");
    await page.getByRole("searchbox").fill("models");
    // Wait for the lazy-loaded palette index to populate at least one
    // result. Without this the next Enter is a no-op (flat[] is empty
    // until /api/v1/internal/search-index.json resolves).
    await expect(page.getByRole("option").first()).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/models/);
  });

  test("Nav button opens the palette", async ({ page }) => {
    // networkidle: cmd-K is bound via <svelte:window onkeydown> in
    // +layout.svelte; the handler is wired only after hydration.
    await page.goto("/", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: /Open command palette/i }).click();
    await expect(page.getByRole("dialog", { name: /command palette/i }))
      .toBeVisible();
  });
});
