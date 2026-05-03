import { expect, test } from "@playwright/test";
import { FIXTURE } from "../utils/seed-fixtures";

test.describe("/runs/:id", () => {
  test("renders 4 tabs + Results active by default", async ({ page }) => {
    await page.goto(`/runs/${FIXTURE.run.run0}`);
    await expect(page.getByRole("tab", { name: "Results" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByRole("tab", { name: "Settings" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Signature" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Reproduction" })).toBeVisible();
  });

  test("arrow-right cycles tabs", async ({ page }) => {
    // networkidle (not the default `load`) is required so Svelte hydration
    // completes before the keydown handler is exercised. focus() lands on
    // the SSR'd button immediately, but the onkeydown listener attaches
    // only after the client bundle hydrates the Tabs component.
    await page.goto(`/runs/${FIXTURE.run.run0}`, { waitUntil: "networkidle" });
    await page.getByRole("tab", { name: "Results" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "Settings" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  test("signature tab loads and verify works", async ({ page }) => {
    await page.goto(`/runs/${FIXTURE.run.run0}`, { waitUntil: "networkidle" });
    // Wait for the signature API response that the click triggers,
    // rather than racing the network with a fixed timeout. Eliminates
    // the "first-hit slow, retry fast" flake mode entirely.
    const sigResponse = page.waitForResponse((r) =>
      r.url().includes(`/api/v1/runs/${FIXTURE.run.run0}/signature`)
    );
    await page.getByRole("tab", { name: "Signature" }).click();
    await sigResponse;
    await expect(page.getByRole("button", { name: /verify/i })).toBeVisible();
    await page.getByRole("button", { name: /verify/i }).click();
    // Either valid (✓) or invalid (✗) — both are valid outcomes; we just want
    // confirmation the button responded
    await expect(page.locator(".ok, .bad")).toBeVisible({ timeout: 5000 });
  });
});
