import { expect, test } from "@playwright/test";

test.describe("keyboard", () => {
  test("Tab order on / skips skip-link first", async ({ page }) => {
    // networkidle: keyboard handlers (cmd-K, cmd-shift-D, sort buttons,
    // palette nav) attach during Svelte hydration. Default `load` fires
    // before that — keypresses arrive before listeners are wired.
    await page.goto("/", { waitUntil: "networkidle" });
    await page.keyboard.press("Tab");
    const focusedId = await page.evaluate(() =>
      document.activeElement?.getAttribute("href")
    );
    expect(focusedId).toBe("#main");
  });

  test("sort headers activate on Enter", async ({ page }) => {
    // networkidle: keyboard handlers (cmd-K, cmd-shift-D, sort buttons,
    // palette nav) attach during Svelte hydration. Default `load` fires
    // before that — keypresses arrive before listeners are wired.
    await page.goto("/", { waitUntil: "networkidle" });
    const scoreHeader = page.getByRole("button", { name: /Score/ });
    await scoreHeader.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/sort=/);
  });

  test("cmd-K opens palette and Esc returns focus to nav button", async ({ page }) => {
    // networkidle: keyboard handlers (cmd-K, cmd-shift-D, sort buttons,
    // palette nav) attach during Svelte hydration. Default `load` fires
    // before that — keypresses arrive before listeners are wired.
    await page.goto("/", { waitUntil: "networkidle" });
    const navBtn = page.getByRole("button", { name: /Open command palette/i });
    await navBtn.focus();
    await page.keyboard.press("Meta+K");
    await expect(page.getByRole("dialog", { name: /command palette/i }))
      .toBeVisible();
    await page.keyboard.press("Escape");
    await expect(navBtn).toBeFocused();
  });

  test("cmd-shift-d toggles density attribute on <html>", async ({ page }) => {
    // networkidle: keyboard handlers (cmd-K, cmd-shift-D, sort buttons,
    // palette nav) attach during Svelte hydration. Default `load` fires
    // before that — keypresses arrive before listeners are wired.
    await page.goto("/", { waitUntil: "networkidle" });
    const initial = await page.locator("html").getAttribute("data-density");
    await page.keyboard.press("Meta+Shift+D");
    const after = await page.locator("html").getAttribute("data-density");
    // Either initial was null (comfortable default) -> compact, or vice versa
    expect(after).not.toBe(initial);
  });

  test("palette: ArrowDown moves selection, Enter navigates", async ({ page }) => {
    // networkidle: keyboard handlers (cmd-K, cmd-shift-D, sort buttons,
    // palette nav) attach during Svelte hydration. Default `load` fires
    // before that — keypresses arrive before listeners are wired.
    await page.goto("/", { waitUntil: "networkidle" });
    await page.keyboard.press("Meta+K");
    await page.getByRole("searchbox").fill("models");
    // Wait for palette index to populate before keyboard nav.
    await expect(page.getByRole("option").first()).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/models/);
  });
});
