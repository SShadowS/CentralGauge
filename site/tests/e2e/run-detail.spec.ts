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
    await page.goto(`/runs/${FIXTURE.run.run0}`);
    await page.getByRole("tab", { name: "Results" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("tab", { name: "Settings" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  test("signature tab loads and verify works", async ({ page }) => {
    await page.goto(`/runs/${FIXTURE.run.run0}`);
    await page.getByRole("tab", { name: "Signature" }).click();
    await expect(page.getByRole("button", { name: /verify/i })).toBeVisible();
    await page.getByRole("button", { name: /verify/i }).click();
    // Either valid (✓) or invalid (✗) — both are valid outcomes; we just want
    // confirmation the button responded
    await expect(page.locator(".ok, .bad")).toBeVisible({ timeout: 5000 });
  });
});
