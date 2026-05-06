import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 1280, height: 800 } });

test.describe("CHEAT overlay (landing, desktop)", () => {
  test("FAB is visible and toggles aria-pressed", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    const fab = page.locator(".cheat-fab");
    await expect(fab).toBeVisible();
    await expect(fab).toHaveAttribute("aria-pressed", "false");
    await expect(fab).toContainText("CHEAT");

    await fab.click();
    await expect(fab).toHaveAttribute("aria-pressed", "true");
    await expect(fab).toContainText("CHEATING");

    // Esc dismisses
    await page.keyboard.press("Escape");
    await expect(fab).toHaveAttribute("aria-pressed", "false");
    await expect(fab).toContainText("CHEAT");
  });

  test("opens portal layer with role=note callouts", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    await page.locator(".cheat-fab").click();
    await expect(page.locator(".cheat-layer")).toBeVisible();
    // At least one column callout should have rendered (resolveTargets
    // populates from data-cheat="*-col" anchors mounted on table headers).
    await expect(page.locator('[role="note"]').first()).toBeAttached();
  });

  test("page stays click-through usable: clicking sort header still toggles sort", async ({
    page,
  }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    await page.locator(".cheat-fab").click();
    await expect(page.locator(".cheat-layer")).toBeVisible();

    // The Score header sits under the click-through layer. force:true bypasses
    // Playwright's actionability gate (the layer is pointer-events:none, so the
    // browser will route the click to the underlying button — but Playwright's
    // hit-test sees the layer first).
    await page.locator('[data-test="pass-at-n-header"] button').click({ force: true });
    await expect(page).toHaveURL(/sort=pass_at_n/);

    // Overlay still present (not auto-closed by click on page underneath)
    await expect(page.locator(".cheat-fab")).toHaveAttribute("aria-pressed", "true");
  });

  test("X close button dismisses the overlay", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    await page.locator(".cheat-fab").click();
    await expect(page.locator(".cheat-layer")).toBeVisible();
    await page.locator(".cheat-close").click();
    await expect(page.locator(".cheat-layer")).toHaveCount(0);
    await expect(page.locator(".cheat-fab")).toHaveAttribute("aria-pressed", "false");
  });
});
