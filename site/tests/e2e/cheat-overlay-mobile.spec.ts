import { expect, test } from "@playwright/test";

const mobileViewports = [
  { width: 375, height: 667, name: "phone" },
  { width: 900, height: 800, name: "tablet" },
  { width: 1024, height: 768, name: "boundary-mobile" },
];

for (const viewport of mobileViewports) {
  test(`mobile sheet opens at ${viewport.width}x${viewport.height} (${viewport.name})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto("/", { waitUntil: "networkidle" });

    await page.locator(".cheat-fab").click();
    const dialog = page.locator("dialog.cheat-sheet");
    await expect(dialog).toBeVisible();

    // No SVG arrow layer on mobile
    expect(await page.locator(".cheat-arrows").count()).toBe(0);
    // Numbered list present
    await expect(page.locator(".cheat-sheet ol.cards li.card").first()).toBeVisible();

    // Close via the X button
    await page.locator(".cheat-sheet .x").click();
    await expect(dialog).toBeHidden();
  });
}

test("desktop overlay opens at 1025x768 (boundary, just above mobile cutoff)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1025, height: 768 });
  await page.goto("/", { waitUntil: "networkidle" });

  await page.locator(".cheat-fab").click();
  await expect(page.locator(".cheat-layer")).toBeVisible();
  await expect(page.locator("dialog.cheat-sheet")).toHaveCount(0);
});
